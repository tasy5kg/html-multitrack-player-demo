document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elements ---
    const songSelect = document.getElementById('song-select');
    const selectedSongName = document.getElementById('selected-song-name');
    const qualitySelectionContainer = document.getElementById('quality-selection-container');
    const loadHqBtn = document.getElementById('load-hq-btn');
    const loadLqBtn = document.getElementById('load-lq-btn');
    const hqSizeSpan = document.getElementById('hq-size');
    const lqSizeSpan = document.getElementById('lq-size');
    const mainPlayerControls = document.getElementById('main-player-controls');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const loadingIcon = document.getElementById('loading-icon');
    const errorIcon = document.getElementById('error-icon');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const progressStatusContainer = document.getElementById('progress-status-container');
    const loadingText = document.getElementById('loading-text');
    const errorText = document.getElementById('error-text');
    const playerProgressContainer = document.getElementById('player-progress-container');
    const masterProgress = document.getElementById('master-progress');
    const currentTimeDisplay = document.getElementById('current-time');
    const totalDurationDisplay = document.getElementById('total-duration');
    const progressTooltip = document.getElementById('progress-tooltip');
    const mixerTracksContainer = document.getElementById('mixer-tracks');
    const masterMeterBar = document.getElementById('master-meter-bar');

    // --- State Management ---
    const state = {
        audioContext: null,
        masterGainNode: null,
        masterAnalyserNode: null,
        masterTimeDomainData: null,
        tracks: [],
        songsList: [],
        currentSong: null,
        isInitialized: false,
        isPlaying: false,
        isSeeking: false,
        isAnyTrackSoloed: false,
        startTime: 0,
        startOffset: 0,
        minDuration: Infinity,
        animationFrameId: null,
        totalDownloadSize: 0,
        storedHqBytes: 0,
        storedLqBytes: 0,
        resizeObserver: null,
    };

    // --- Initialization ---

    /**
     * Main initialization function, entry point of the application.
     */
    function initialize() {
        mainPlayerControls.classList.add('hidden');
        qualitySelectionContainer.classList.add('hidden');
        mixerTracksContainer.innerHTML = '';
        loadSongsList();
        bindGlobalEvents();
    }

    /**
     * Fetches the list of songs from songs.json and populates the dropdown.
     */
    async function loadSongsList() {
        try {
            const response = await fetch('songs.json');
            if (!response.ok) throw new Error('Failed to load songs list.');
            state.songsList = await response.json();
            
            songSelect.innerHTML = '<option value="" selected disabled>请选择歌曲</option>';
            state.songsList.forEach((song, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = song.name;
                songSelect.appendChild(option);
            });
        } catch (error) {
            console.error(error);
            songSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }

    /**
     * Binds event listeners that are available from the start.
     */
    function bindGlobalEvents() {
        songSelect.addEventListener('change', handleSongSelection);
        loadHqBtn.addEventListener('click', () => startLoading('hq'));
        loadLqBtn.addEventListener('click', () => startLoading('lq'));
        playPauseBtn.addEventListener('click', togglePlayPause);

        // Master progress bar events
        masterProgress.addEventListener('input', handleMasterProgressInput);
        masterProgress.addEventListener('change', handleMasterProgressChange);
        masterProgress.addEventListener('mousedown', () => state.isSeeking = true);
        masterProgress.addEventListener('mouseup', () => state.isSeeking = false);
        masterProgress.addEventListener('touchstart', () => state.isSeeking = true, { passive: true });
        masterProgress.addEventListener('touchend', () => state.isSeeking = false);
    }

    // --- Song & Quality Selection ---

    /**
     * Handles the change event of the song selection dropdown.
     */
    function handleSongSelection() {
        const selectedIndex = songSelect.value;
        if (state.songsList[selectedIndex]) {
            state.currentSong = state.songsList[selectedIndex];
            // Update UI
            songSelect.classList.add('hidden');
            selectedSongName.textContent = state.currentSong.name;
            selectedSongName.classList.remove('hidden');
            qualitySelectionContainer.classList.remove('hidden');
            mainPlayerControls.classList.add('hidden');

            // 显示BPM和调式
            const songInfoDiv = document.getElementById('song-info');
            if (state.currentSong.bpm && state.currentSong.song_key) {
                songInfoDiv.innerHTML = `BPM: ${state.currentSong.bpm}&nbsp;&nbsp;调式: ${state.currentSong.song_key}`;
            } else if (state.currentSong.bpm) {
                songInfoDiv.textContent = `BPM: ${state.currentSong.bpm}`;
            } else if (state.currentSong.song_key) {
                songInfoDiv.textContent = `调式: ${state.currentSong.song_key}`;
            } else {
                songInfoDiv.textContent = '';
            }
            songInfoDiv.classList.remove('hidden');

            resetPlayerState();
            setupNewSong();
        }
    }

    /**
     * Resets the player state when a new song is selected.
     */
    function resetPlayerState() {
        if (state.audioContext && state.audioContext.state !== 'closed') {
            state.audioContext.close();
        }
        if (state.resizeObserver) {
            state.resizeObserver.disconnect();
        }
        
        Object.assign(state, {
            audioContext: null,
            masterGainNode: null,
            masterAnalyserNode: null,
            masterTimeDomainData: null,
            tracks: [],
            isInitialized: false,
            isPlaying: false,
            isAnyTrackSoloed: false,
            startOffset: 0,
            minDuration: Infinity,
            totalDownloadSize: 0,
            storedHqBytes: 0,
            storedLqBytes: 0,
            resizeObserver: null,
        });
        
        mixerTracksContainer.innerHTML = '';
        cancelAnimationFrame(state.animationFrameId);
    }
    
    /**
     * Sets up UI and calculates sizes for the newly selected song.
     */
    function setupNewSong() {
        const tracksData = state.currentSong.tracksData.map(track => ({
            name: track.name,
            baseName: track.file, 
            defaultVolume: 75,
            folder: state.currentSong.folder,
        }));

        createTrackUI(tracksData);
        
        hqSizeSpan.textContent = '(计算中…)';
        lqSizeSpan.textContent = '(计算中…)';
        loadHqBtn.disabled = true;
        loadLqBtn.disabled = true;

        Promise.all([
            calculateTotalSize('ogg', hqSizeSpan),
            calculateTotalSize('m4a', lqSizeSpan)
        ]).then(([hqBytes, lqBytes]) => {
            state.storedHqBytes = hqBytes;
            state.storedLqBytes = lqBytes;
            loadHqBtn.disabled = false;
            loadLqBtn.disabled = false;
        });
    }

    /**
     * Starts the audio loading process after quality selection.
     * @param {'hq' | 'lq'} quality - The selected audio quality.
     */
    function startLoading(quality) {
        qualitySelectionContainer.classList.add('hidden');
        mainPlayerControls.classList.remove('hidden');
        
        const extension = quality === 'hq' ? 'ogg' : 'm4a';
        state.tracks.forEach(track => {
            track.file = `${track.folder}/${track.baseName}.${extension}`;
        });
        
        state.totalDownloadSize = (quality === 'hq') ? state.storedHqBytes : state.storedLqBytes;
        initializeAudio();
    }

    // --- Audio Processing ---

    /**
     * Initializes the Web Audio API context and loads all audio tracks.
     */
    async function initializeAudio() {
        if (state.isInitialized) return;
        state.isInitialized = true;
        
        updatePlayPauseButton(true); // Show loading state
        loadingText.innerHTML = `正在加载音频资源(<span id="load-progress-percent">0</span>%)`;

        try {
            state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create and connect master nodes
            state.masterGainNode = state.audioContext.createGain();
            state.masterAnalyserNode = state.audioContext.createAnalyser();
            state.masterAnalyserNode.fftSize = 2048;
            state.masterTimeDomainData = new Float32Array(state.masterAnalyserNode.fftSize);
            state.masterGainNode.connect(state.masterAnalyserNode);
            state.masterAnalyserNode.connect(state.audioContext.destination);

            // Create audio nodes for each track
            state.tracks.forEach(track => {
                const gainNode = state.audioContext.createGain();
                gainNode.gain.value = track.isMuted ? 0 : track.lastVolume;
                const analyserNode = state.audioContext.createAnalyser();
                analyserNode.fftSize = 2048;
                
                // Connect track: gain -> analyser -> masterGain
                gainNode.connect(analyserNode);
                analyserNode.connect(state.masterGainNode);
                
                track.gainNode = gainNode;
                track.analyserNode = analyserNode;
                track.timeDomainData = new Float32Array(analyserNode.fftSize);
            });

            await loadAudioTracksWithProgress();
            
            mixerTracksContainer.classList.remove('opacity-50', 'pointer-events-none');
            playPauseBtn.disabled = false;

            updateAllTrackVolumes();
            initializeResizeObserver();
            updateMasterProgressFill();

            play();

        } catch (error) {
            console.error("Audio initialization failed:", error);
            loadingIcon.classList.add('hidden');
            loadingText.classList.add('hidden');
            errorText.classList.remove('hidden');
            errorIcon.classList.remove('hidden');
            playPauseBtn.classList.add('bg-red-500');
        }
    }

    /**
     * Loads audio files streamingly with progress updates.
     */
    async function loadAudioTracksWithProgress() {
        let loadedBytes = 0;
        const loadProgressPercentSpan = document.getElementById('load-progress-percent');

        const loadPromises = state.tracks.map(async (track) => {
            if (!track.file) throw new Error(`File path for track "${track.name}" is not set.`);
            
            const response = await fetch(track.file);
            if (!response.ok) throw new Error(`Could not load ${track.file}`);
            if (!response.body) throw new Error('Streaming not supported.');

            const reader = response.body.getReader();
            const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loadedBytes += value.length;
                if (state.totalDownloadSize > 0) {
                    const percent = Math.min(100, Math.round((loadedBytes / state.totalDownloadSize) * 100));
                    if (loadProgressPercentSpan) loadProgressPercentSpan.textContent = percent;
                }
            }
            
            const blob = new Blob(chunks);
            const arrayBuffer = await blob.arrayBuffer();
            track.audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
            track.waveformData = generateWaveformData(track.audioBuffer);

            return track.audioBuffer.duration;
        });

        const results = await Promise.allSettled(loadPromises);
        const successfulLoads = results.filter(r => r.status === 'fulfilled').map(r => r.value);

        if (results.some(r => r.status === 'rejected')) {
            const failed = results.find(r => r.status === 'rejected');
            throw new Error(`Load failed: ${failed.reason.message}`);
        }

        state.minDuration = Math.min(...successfulLoads);
        masterProgress.max = state.minDuration;
        totalDurationDisplay.textContent = formatTime(state.minDuration);
        progressStatusContainer.classList.add('hidden');
        playerProgressContainer.classList.remove('hidden');

        state.tracks.forEach(drawWaveform);
    }
    
    /**
     * Starts or resumes playback for all tracks.
     */
    function play() {
        if (state.isPlaying) return;
        if (state.audioContext.state === 'suspended') {
            state.audioContext.resume();
        }
        if (state.startOffset >= state.minDuration) state.startOffset = 0;

        state.tracks.forEach(track => {
            const source = state.audioContext.createBufferSource();
            source.buffer = track.audioBuffer;
            source.connect(track.gainNode);
            source.start(0, state.startOffset);
            track.sourceNode = source;
        });

        state.isPlaying = true;
        state.startTime = state.audioContext.currentTime;
        updateAllTrackVolumes();
        updatePlayPauseButton();
        state.animationFrameId = requestAnimationFrame(updateProgress);
    }

    /**
     * Pauses playback for all tracks.
     */
    function pause() {
        if (!state.isPlaying) return;
        const elapsed = state.audioContext.currentTime - state.startTime;
        cancelAnimationFrame(state.animationFrameId);

        state.tracks.forEach(track => {
            if (track.sourceNode) {
                track.sourceNode.stop(0);
                track.sourceNode.disconnect();
                track.sourceNode = null;
            }
        });

        state.isPlaying = false;
        state.startOffset += elapsed;
        updatePlayPauseButton();
    }
    
    /**
     * Toggles between play and pause states.
     */
    function togglePlayPause() {
        if (!state.isInitialized) return;
        if (state.isPlaying) {
            pause();
        } else {
            play();
        }
    }

    // --- UI & Visualization ---
    
    /**
     * Creates and appends the UI for all tracks.
     * @param {Array<Object>} tracksData - The data for all tracks.
     */
    function createTrackUI(tracksData) {
        mixerTracksContainer.innerHTML = '';
        state.tracks = [];
        mixerTracksContainer.classList.add('opacity-50', 'pointer-events-none');

        tracksData.forEach((trackData) => {
            const { trackElement, uiComponents } = buildSingleTrackUI(trackData);
            mixerTracksContainer.appendChild(trackElement);
            
            const isMetronome = trackData.name === '节拍器';
            
            const track = {
                ...trackData,
                lastVolume: trackData.defaultVolume / 100,
                isMuted: isMetronome,
                isSoloed: false,
                ui: uiComponents,
            };
            
            state.tracks.push(track);
            bindTrackEvents(track);

            // Initial UI state
            updateVolumeSliderFill(uiComponents.volumeSlider, trackData.defaultVolume);
            if (isMetronome) {
                uiComponents.muteBtn.classList.add('active');
            }
        });
        
        // Hide all volume tooltips initially
        const hideAllTooltips = () => {
            state.tracks.forEach(track => hideTooltip(track.ui));
        };
        document.addEventListener('mouseup', hideAllTooltips);
        document.addEventListener('touchend', hideAllTooltips);
    }
    
    /**
     * Builds the DOM elements for a single track.
     * @param {Object} trackData - The data for one track.
     * @returns {{trackElement: HTMLElement, uiComponents: Object}}
     */
    function buildSingleTrackUI(trackData) {
        const trackElement = document.createElement('div');
        trackElement.className = 'py-3';
        
        // Top Row: Label, Slider, Controls
        const topRow = document.createElement('div');
        topRow.className = 'flex items-center justify-between space-x-4 mb-2';
        
        const label = document.createElement('label');
        label.textContent = trackData.name;
        label.className = 'text-sm font-bold text-gray-700 w-28 truncate';

        const { sliderWrapper, volumeSlider, volumeTooltip } = createVolumeSlider(trackData);
        const { soloMuteContainer, muteBtn, soloBtn } = createControlButtons();
        
        topRow.append(label, sliderWrapper, soloMuteContainer);
        
        // Bottom Row: Waveform, Meter
        const bottomRow = document.createElement('div');
        bottomRow.className = 'flex items-center space-x-2';
        
        const waveformContainer = document.createElement('div');
        waveformContainer.className = 'waveform-container flex-grow';
        
        const { meterWrapper, meterBar } = createLevelMeter();
        
        bottomRow.append(waveformContainer, meterWrapper);
        trackElement.append(topRow, bottomRow);

        return {
            trackElement,
            uiComponents: { volumeSlider, tooltip: volumeTooltip, meterBar, waveformContainer, muteBtn, soloBtn }
        };
    }
    
    // --- UI Component Builders ---

    function createVolumeSlider(trackData) {
        const sliderWrapper = document.createElement('div');
        sliderWrapper.className = 'volume-slider-wrapper relative flex-grow h-[20px] flex items-center';
        const volumeSlider = document.createElement('input');
        Object.assign(volumeSlider, { type: 'range', min: 0, max: 100, value: trackData.defaultVolume });
        volumeSlider.className = 'volume-slider w-full';
        
        const volumeTooltip = document.createElement('div');
        volumeTooltip.className = 'volume-tooltip absolute top-0 bg-gray-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 transition-opacity duration-200';
        volumeTooltip.textContent = `${trackData.defaultVolume}%`;
        
        sliderWrapper.append(volumeSlider, volumeTooltip);
        return { sliderWrapper, volumeSlider, volumeTooltip };
    }

    function createControlButtons() {
        const soloMuteContainer = document.createElement('div');
        soloMuteContainer.className = 'flex items-center space-x-2 flex-shrink-0';
        const muteBtn = document.createElement('button');
        muteBtn.textContent = '静音';
        muteBtn.className = 'control-button mute-button';
        const soloBtn = document.createElement('button');
        soloBtn.textContent = '独奏';
        soloBtn.className = 'control-button solo-button';
        soloMuteContainer.append(muteBtn, soloBtn);
        return { soloMuteContainer, muteBtn, soloBtn };
    }

    function createLevelMeter() {
        const meterWrapper = document.createElement('div');
        meterWrapper.className = 'vertical-meter-wrapper';
        const meterBar = document.createElement('div');
        meterBar.className = 'vertical-meter-bar';
        meterWrapper.appendChild(meterBar);
        return { meterWrapper, meterBar };
    }
    
    // --- Event Binding ---
    
    /**
     * Binds events to a single track's UI elements.
     * @param {Object} track - The track object.
     */
    function bindTrackEvents(track) {
        const { volumeSlider, muteBtn, soloBtn, waveformContainer } = track.ui;
        
        volumeSlider.addEventListener('input', e => handleVolumeChange(e, track));
        volumeSlider.addEventListener('mousedown', () => showTooltip(track.ui));
        volumeSlider.addEventListener('touchstart', () => showTooltip(track.ui), { passive: true });
        
        muteBtn.addEventListener('click', () => handleMuteClick(track));
        soloBtn.addEventListener('click', () => handleSoloClick(track));
        
        waveformContainer.addEventListener('click', e => handleWaveformClick(e, track, waveformContainer));
    }
    
    // --- Event Handlers ---
    
    function handleVolumeChange(event, track) {
        const value = parseFloat(event.target.value);
        track.lastVolume = value / 100;
        updateAllTrackVolumes();
        updateVolumeSliderFill(track.ui.volumeSlider, value);
        updateTooltip(track.ui);
    }
    
    function handleMuteClick(track) {
        track.isMuted = !track.isMuted;
        track.ui.muteBtn.classList.toggle('active', track.isMuted);
        updateAllTrackVolumes();
    }
    
    function handleSoloClick(track) {
        track.isSoloed = !track.isSoloed;
        track.ui.soloBtn.classList.toggle('active', track.isSoloed);
        state.isAnyTrackSoloed = state.tracks.some(t => t.isSoloed);
        updateAllTrackVolumes();
    }
    
    function handleWaveformClick(event, track, container) {
        const rect = container.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const seekTime = (clickX / rect.width) * state.minDuration;
        
        seek(seekTime);
    }
    
    function handleMasterProgressInput() {
        showProgressTooltip();
        updateMasterProgressFill();
    }

    function handleMasterProgressChange() {
        hideProgressTooltip();
        seek(parseFloat(masterProgress.value));
    }
    
    /**
     * Seeks to a specific time in the audio.
     * @param {number} seekTime - The time to seek to, in seconds.
     */
    function seek(seekTime) {
        if (state.isPlaying) {
            pause();
            state.startOffset = seekTime;
            play();
        } else {
            state.startOffset = seekTime;
            masterProgress.value = seekTime;
            currentTimeDisplay.textContent = formatTime(seekTime);
            updateWaveformProgressLine(seekTime);
            updateMasterProgressFill();
        }
    }
    
    // --- Volume & Mute/Solo Logic ---
    
    /**
     * Updates the actual gain of all tracks based on their mute/solo state.
     */
    function updateAllTrackVolumes() {
        if (!state.audioContext) return;

        state.tracks.forEach(track => {
            let finalVolume = 0;
            if (state.isAnyTrackSoloed) {
                if (track.isSoloed && !track.isMuted) {
                    finalVolume = track.lastVolume;
                }
            } else {
                if (!track.isMuted) {
                    finalVolume = track.lastVolume;
                }
            }
            if (track.gainNode) {
                track.gainNode.gain.setTargetAtTime(finalVolume, state.audioContext.currentTime, 0.01);
            }
        });
    }

    // --- Animation & Updates ---
    
    /**
     * The main update loop called by requestAnimationFrame.
     */
    function updateProgress() {
        if (!state.isPlaying) {
            cancelAnimationFrame(state.animationFrameId);
            return;
        }

        const latency = state.audioContext.outputLatency || 0;
        const currentTime = state.startOffset + (state.audioContext.currentTime - state.startTime) - latency;

        if (currentTime >= state.minDuration) {
            pause();
            state.startOffset = state.minDuration;
            masterProgress.value = state.minDuration;
            currentTimeDisplay.textContent = formatTime(state.minDuration);
            updateWaveformProgressLine(state.minDuration);
            updateMasterProgressFill();
        } else {
            if (!state.isSeeking) {
                masterProgress.value = currentTime;
                currentTimeDisplay.textContent = formatTime(currentTime);
                updateWaveformProgressLine(currentTime);
                updateMasterProgressFill();
            }
            state.animationFrameId = requestAnimationFrame(updateProgress);
        }
        updateLevelMeters();
        updateMasterLevelMeter();
    }
    
    /**
     * Updates the visual level meters for each track.
     */
    function updateLevelMeters() {
        state.tracks.forEach(track => {
            if (!track.analyserNode || !track.ui.meterBar) return;
            updateSingleMeter(track.analyserNode, track.timeDomainData, track.ui.meterBar);
        });
    }

    /**
     * Updates the visual level meter for the master output.
     */
    function updateMasterLevelMeter() {
        if (!state.masterAnalyserNode || !masterMeterBar) return;
        updateSingleMeter(state.masterAnalyserNode, state.masterTimeDomainData, masterMeterBar);
    }
    
    /**
     * Generic function to update a single level meter UI.
     * @param {AnalyserNode} analyserNode 
     * @param {Float32Array} timeDomainData 
     * @param {HTMLElement} meterBar 
     */
    function updateSingleMeter(analyserNode, timeDomainData, meterBar) {
        const MIN_DB = -60.0;
        analyserNode.getFloatTimeDomainData(timeDomainData);
        let peakAmplitude = 0.0;
        for (const sample of timeDomainData) {
            const absSample = Math.abs(sample);
            if (absSample > peakAmplitude) peakAmplitude = absSample;
        }
        
        if (peakAmplitude === 0) {
            meterBar.style.height = '0%';
            return;
        }
        
        const peakDb = 20 * Math.log10(peakAmplitude);
        const levelPercent = peakDb < MIN_DB ? 0 : Math.min(100, Math.max(0, ((((peakDb - MIN_DB) / -MIN_DB) ** 2) * 100) | 0));
        
        meterBar.style.height = `${levelPercent}%`;
        meterBar.style.backgroundColor = `rgb(0, 166, 62)`;
    }
    
    // --- UI Update Functions ---
    
    function updatePlayPauseButton(isLoading = false) {
        if (isLoading) {
            playPauseBtn.disabled = true;
            playIcon.classList.add('hidden');
            pauseIcon.classList.add('hidden');
            loadingIcon.classList.remove('hidden');
            return;
        }
        playPauseBtn.disabled = false;
        loadingIcon.classList.add('hidden');
        playIcon.classList.toggle('hidden', state.isPlaying);
        pauseIcon.classList.toggle('hidden', !state.isPlaying);
        
        const fromColor = state.isPlaying ? 'bg-blue-500' : 'bg-amber-500';
        const toColor = state.isPlaying ? 'bg-amber-500' : 'bg-blue-500';
        const fromHover = state.isPlaying ? 'hover:bg-blue-600' : 'hover:bg-amber-600';
        const toHover = state.isPlaying ? 'hover:bg-amber-600' : 'hover:bg-blue-600';
        
        playPauseBtn.classList.replace(fromColor, toColor);
        playPauseBtn.classList.replace(fromHover, toHover);
    }
    
    function updateVolumeSliderFill(slider, value) {
        const percent = Math.max(0, Math.min(100, value));
        // 从 input 元素（slider）获取其父元素（即 .volume-slider-wrapper）
        const wrapper = slider.parentElement;
    
        // 在父元素上设置 CSS 变量，以便 ::after 伪元素能够正确获取
        if (wrapper) {
            wrapper.style.setProperty('--value-percent', `${percent}%`);
            wrapper.style.setProperty('--triangle-x', `${percent}%`);
            wrapper.style.setProperty('--triangle-y', `${100 - percent}%`);
        }
    }

    function updateMasterProgressFill() {
        const percent = (masterProgress.value / masterProgress.max) * 100 || 0;
        masterProgress.style.backgroundSize = `${percent}% 100%`;
    }
    
    // --- Waveform ---
    
    /**
     * Generates waveform data from an audio buffer.
     * @param {AudioBuffer} audioBuffer - The decoded audio data.
     * @returns {Array<{min: number, max: number}>}
     */
    function generateWaveformData(audioBuffer) {
        const sampleInterval = 0.1; // 10 points per second
        const channelsData = Array.from({ length: audioBuffer.numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));
        const samplesPerPoint = Math.floor(audioBuffer.sampleRate * sampleInterval);
        const pointsCount = Math.floor(audioBuffer.duration / sampleInterval);
        const waveformPoints = [];

        for (let i = 0; i < pointsCount; i++) {
            const start = i * samplesPerPoint;
            const end = Math.min(start + samplesPerPoint, audioBuffer.length);
            let min = 1.0;
            let max = -1.0;

            for (let j = start; j < end; j++) {
                for (let channel = 0; channel < channelsData.length; channel++) {
                    const sample = channelsData[channel][j];
                    if (sample < min) min = sample;
                    if (sample > max) max = sample;
                }
            }
            waveformPoints.push({ min, max });
        }
        return waveformPoints;
    }

    /**
     * Renders the waveform for a given track using SVG.
     * @param {Object} track - The track object.
     */
    function drawWaveform(track) {
        const { ui, waveformData } = track;
        const container = ui.waveformContainer;
        if (!waveformData || waveformData.length === 0) return;

        const width = waveformData.length;
        const height = 100;
        const halfHeight = height / 2;

        let pathData = `M 0 ${halfHeight}`;
        for (let i = 0; i < waveformData.length; i++) {
            pathData += ` L ${i} ${halfHeight - (waveformData[i].max * halfHeight)}`;
        }
        for (let i = waveformData.length - 1; i >= 0; i--) {
            pathData += ` L ${i} ${halfHeight - (waveformData[i].min * halfHeight)}`;
        }
        pathData += ' Z';

        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('preserveAspectRatio', 'none');

        const path = document.createElementNS(svgNS, "path");
        path.setAttribute('d', pathData);
        path.setAttribute('fill', '#10B981');

        const baseline = document.createElementNS(svgNS, "line");
        baseline.setAttribute('x1', '0');
        baseline.setAttribute('y1', String(halfHeight));
        baseline.setAttribute('x2', String(width));
        baseline.setAttribute('y2', String(halfHeight));
        baseline.setAttribute('class', 'waveform-baseline');

        ui.progressLine = document.createElementNS(svgNS, "line");
        ui.progressLine.setAttribute('x1', '0');
        ui.progressLine.setAttribute('y1', '0');
        ui.progressLine.setAttribute('x2', '0');
        ui.progressLine.setAttribute('y2', String(height));
        ui.progressLine.setAttribute('class', 'waveform-progress-line');

        svg.append(path, baseline, ui.progressLine);
        container.innerHTML = '';
        container.appendChild(svg);
        
        updateWaveformProgressLine(state.startOffset);
    }
    
    /**
     * Updates the position of the progress line on all waveforms.
     * @param {number} currentTime - The current playback time.
     */
    function updateWaveformProgressLine(currentTime) {
        state.tracks.forEach(track => {
            if (!track.ui.progressLine || !track.waveformData || !track.audioBuffer) return;
            
            const trackDuration = track.audioBuffer.duration;
            const progressPercent = Math.max(0, Math.min(1, currentTime / trackDuration));
            const xPos = progressPercent * track.waveformData.length;
            
            track.ui.progressLine.setAttribute('transform', `translate(${xPos}, 0)`);
            track.ui.progressLine.style.display = (currentTime >= trackDuration) ? 'none' : 'block';
        });
    }

    function initializeResizeObserver() {
        if (state.resizeObserver) state.resizeObserver.disconnect();
        state.resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                const currentTime = state.startOffset + (state.isPlaying ? (state.audioContext.currentTime - state.startTime) : 0);
                updateWaveformProgressLine(currentTime);
            });
        });
        state.tracks.forEach(track => {
            if (track.ui.waveformContainer) {
                state.resizeObserver.observe(track.ui.waveformContainer);
            }
        });
    }
    
    // --- Tooltips ---

    function showTooltip(ui) { ui.tooltip.style.opacity = '1'; updateTooltip(ui); }
    function hideTooltip(ui) { ui.tooltip.style.opacity = '0'; }
    function updateTooltip(ui) {
        const slider = ui.volumeSlider;
        const value = slider.value;
        ui.tooltip.textContent = `${value}%`;
        
        const thumbWidth = 20;
        const trackWidth = slider.parentElement.offsetWidth;
        const percent = value / 100;
        let thumbPosition = percent * (trackWidth - thumbWidth) + (thumbWidth / 2);
        
        // Center tooltip over thumb
        const tooltipWidth = ui.tooltip.offsetWidth;
        thumbPosition = Math.max(tooltipWidth / 2, Math.min(thumbPosition, trackWidth - tooltipWidth / 2));
        ui.tooltip.style.left = `${thumbPosition}px`;
    }

    function showProgressTooltip() {
        progressTooltip.style.opacity = '1';
        updateProgressTooltip();
    }
    function hideProgressTooltip() { progressTooltip.style.opacity = '0'; }
    function updateProgressTooltip() {
        if (!progressTooltip) return;
        const val = masterProgress.value;
        progressTooltip.textContent = formatTime(val);

        const trackWidth = masterProgress.offsetWidth;
        const thumbWidth = 16;
        const percent = val / masterProgress.max;
        
        // Center tooltip over thumb
        let thumbPosition = percent * (trackWidth - thumbWidth) + (thumbWidth / 2);
        const tooltipWidth = progressTooltip.offsetWidth;
        const left = Math.max(0, thumbPosition - tooltipWidth / 2);
        
        progressTooltip.style.left = `${Math.min(left, trackWidth - tooltipWidth)}px`;
    }

    // --- Utilities ---

    /**
     * Calculates the total size of all tracks for a given file extension.
     * @param {string} extension - The file extension (e.g., 'ogg', 'm4a').
     * @param {HTMLElement} spanElement - The element to display the size in.
     * @returns {Promise<number>} - The total size in bytes.
     */
    async function calculateTotalSize(extension, spanElement) {
        let totalBytes = 0;
        try {
            const promises = state.currentSong.tracksData.map(track => {
                const url = `${state.currentSong.folder}/${track.file}.${extension}`;
                return fetch(url, { method: 'HEAD' });
            });
            const results = await Promise.allSettled(promises);
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value.ok) {
                    const size = result.value.headers.get('content-length');
                    if (size) totalBytes += parseInt(size, 10);
                }
            }
            spanElement.textContent = totalBytes > 0 ? `(${(totalBytes / 1024 / 1024).toFixed(1)}MB)` : `(未知大小)`;
        } catch (error) {
            console.warn(`Could not get total size for ${extension}:`, error);
            spanElement.textContent = `(获取失败)`;
        }
        return totalBytes;
    }
    
    /**
     * Formats seconds into a MM:SS string.
     * @param {number} seconds - The time in seconds.
     * @returns {string} - The formatted time string.
     */
    function formatTime(seconds) {
        const secs = Math.floor(seconds);
        const minutes = Math.floor(secs / 60);
        const remainingSeconds = secs % 60;
        return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    // --- Start the App ---
    initialize();
});