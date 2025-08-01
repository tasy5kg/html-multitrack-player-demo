import songsListData from './songs.json';

document.addEventListener('DOMContentLoaded', () => {

    const RESOURCE_BASE_URL = '';
    const AUDIO_RESOURCE_SERVERS = ['https://mixmusic-1302021366.cos.ap-chengdu.myqcloud.com', ''];

    // --- DOM Elements ---
    const songSelect = document.getElementById('song-select');
    const mainPlayerControls = document.getElementById('main-player-controls');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const loadingIcon = document.getElementById('loading-icon');
    const errorIcon = document.getElementById('error-icon');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const progressStatusContainer = document.getElementById('progress-status-container');
    const loadingText = document.getElementById('loading-text');
    const errorText = document.getElementById('error-text');
    const retryLoadBtn = document.getElementById('retry-load-btn');
    const playerProgressContainer = document.getElementById('player-progress-container');
    const masterProgress = document.getElementById('master-progress');
    const currentTimeDisplay = document.getElementById('current-time');
    const totalDurationDisplay = document.getElementById('total-duration');
    const progressTooltip = document.getElementById('progress-tooltip');
    const mixerTracksContainer = document.getElementById('mixer-tracks');
    const masterMeterContainer = document.getElementById('master-meter-container');
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
        maxDuration: 0,
        animationFrameId: null,
        totalDownloadSize: 0,
        downloadedBytes: 0,
        loadingSessionId: 0,
        colors: {},
    };

    // --- Initialization ---

    function initialize() {
        mainPlayerControls.classList.add('hidden');
        mixerTracksContainer.innerHTML = '';
        loadSongsList();
        bindGlobalEvents();
        cacheColors();
    }

    function cacheColors() {
        const colorContainer = document.getElementById('wavesurfer-colors');
        if (!colorContainer) return;
        state.colors.cursorColor = getComputedStyle(colorContainer.querySelector('#cursor-color')).color;
        state.colors.waveColor = getComputedStyle(colorContainer.querySelector('#wave-color')).color;
        state.colors.waveColorInactive = getComputedStyle(colorContainer.querySelector('#wave-color-inactive')).color;
        state.colors.progressColor = getComputedStyle(colorContainer.querySelector('#progress-color')).color;
        state.colors.progressColorInactive = getComputedStyle(colorContainer.querySelector('#progress-color-inactive')).color;
        state.colors.meterColor = getComputedStyle(colorContainer.querySelector('#meter-color')).color;
        state.colors.meterColorInactive = getComputedStyle(colorContainer.querySelector('#meter-color-inactive')).color;
        state.colors.meterColorMetronome = getComputedStyle(colorContainer.querySelector('#meter-color-metronome')).color;
        state.colors.meterColorInactiveMetronome = getComputedStyle(colorContainer.querySelector('#meter-color-inactive-metronome')).color;
    }

    function loadSongsList() {
        try {
            state.songsList = songsListData.filter(song => song.enabled);
            songSelect.innerHTML = '<option value="" selected disabled>请选择歌曲</option>';
            state.songsList.forEach((song, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = song.name;
                songSelect.appendChild(option);
            });
        } catch (error) {
            console.error('处理歌曲列表时出错:', error);
            songSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }

    function bindGlobalEvents() {
        songSelect.addEventListener('change', handleSongSelection);
        playPauseBtn.addEventListener('click', togglePlayPause);
        retryLoadBtn.addEventListener('click', handleRetry);

        masterProgress.addEventListener('input', handleMasterProgressInput);
        masterProgress.addEventListener('change', handleMasterProgressChange);
        masterProgress.addEventListener('mousedown', () => state.isSeeking = true);
        masterProgress.addEventListener('mouseup', () => state.isSeeking = false);
        masterProgress.addEventListener('touchstart', () => state.isSeeking = true, {
            passive: true
        });
        masterProgress.addEventListener('touchend', () => state.isSeeking = false);

        document.addEventListener('keydown', handleKeyPress);
    }

    async function fetchWithFallback(relativePath, options, sessionId) {
        let lastError = null;

        for (const server of AUDIO_RESOURCE_SERVERS) {
            if (sessionId !== state.loadingSessionId) throw new Error("Session aborted");
            const url = server ? `${server}/${relativePath}` : relativePath;
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    throw new Error(`请求失败，状态码: ${response.status}`);
                }
                return response;
            } catch (error) {
                console.warn(`从服务器 [${server || '当前网站'}] 加载 ${relativePath} 失败，尝试下一个...`, error.message);
                lastError = error;
            }
        }
        console.error(`所有备用服务器均无法加载资源: ${relativePath}`);
        throw lastError;
    }

    // --- Event Handlers ---

    function handleRetry() {
        setupNewSongAndLoad(++state.loadingSessionId);
    }

    function handleKeyPress(event) {
        const targetTagName = event.target.tagName;
        if (['INPUT', 'SELECT', 'BUTTON'].includes(targetTagName)) {
            return;
        }
        if (event.code === 'Space') {
            event.preventDefault();
            togglePlayPause();
        }
    }


    // --- Song & Quality Selection ---

    function handleSongSelection() {
        state.loadingSessionId++;
        const currentSessionId = state.loadingSessionId;

        const selectedIndex = songSelect.value;
        if (state.songsList[selectedIndex]) {
            state.currentSong = state.songsList[selectedIndex];
            fetch('./log.php', {
                method: 'POST', headers: {
                    'Content-Type': 'application/json',
                }, body: JSON.stringify({
                    songId: state.currentSong.folder
                })
            })
                .then(response => response.json())
                .then(data => {
                    if (data.status !== 'success') {
                        console.error('统计记录失败:', data.message);
                    } else {
                        console.log('统计记录成功。');
                    }
                })
                .catch(error => {
                    console.error('发送统计数据时出错:', error);
                });
            songSelect.blur();
            const songInfoDiv = document.getElementById('song-info');
            if (state.currentSong.bpm && state.currentSong.song_key) {
                songInfoDiv.innerHTML = `BPM: ${state.currentSong.bpm}&nbsp;&nbsp;调式: ${state.currentSong.song_key}&nbsp;&nbsp;<a href="#" id="view-lyrics-link" class="text-blue-500 hover:underline">查看歌词</a>`;
            } else if (state.currentSong.bpm) {
                songInfoDiv.innerHTML = `BPM: ${state.currentSong.bpm}&nbsp;&nbsp;<a href="#" id="view-lyrics-link" class="text-blue-500 hover:underline">查看歌词</a>`;
            } else if (state.currentSong.song_key) {
                songInfoDiv.innerHTML = `调式: ${state.currentSong.song_key}&nbsp;&nbsp;<a href="#" id="view-lyrics-link" class="text-blue-500 hover:underline">查看歌词</a>`;
            } else {
                songInfoDiv.innerHTML = `<a href="#" id="view-lyrics-link" class="text-blue-500 hover:underline">查看歌词</a>`;
            }
            songInfoDiv.classList.remove('hidden');

            setTimeout(() => {
                const viewLyricsLink = document.getElementById('view-lyrics-link');
                if (viewLyricsLink) {
                    viewLyricsLink.onclick = function (e) {
                        e.preventDefault();
                        showLyricsModal(state.currentSong, currentSessionId);
                    };
                }
            }, 0);

            async function showLyricsModal(song, sessionId) {
                const modal = document.getElementById('lyrics-modal');
                const lyricsContent = document.getElementById('lyrics-content');
                const closeBtn = document.getElementById('close-lyrics-modal');
                lyricsContent.textContent = '加载中...';
                modal.classList.remove('hidden');

                const lyricsPath = `${song.folder}/${song.lyrics}`;
                try {
                    const response = await fetchWithFallback(lyricsPath, {}, sessionId);
                    if (sessionId !== state.loadingSessionId) return;
                    const text = await response.text();
                    if (sessionId !== state.loadingSessionId) return;
                    lyricsContent.textContent = text;
                } catch (error) {
                    if (sessionId !== state.loadingSessionId) return;
                    console.error('加载歌词失败:', error);
                    lyricsContent.textContent = '歌词加载失败';
                }

                closeBtn.onclick = function () {
                    modal.classList.add('hidden');
                };
                modal.onclick = function (e) {
                    if (e.target === modal) {
                        modal.classList.add('hidden');
                    }
                };
            }

            resetPlayerState();
            setupNewSongAndLoad(currentSessionId);
        }
    }

    function resetPlayerState() {
        if (state.audioContext && state.audioContext.state !== 'closed') {
            state.audioContext.close();
        }
        state.tracks.forEach(track => {
            if (track.wavesurfer) {
                track.wavesurfer.destroy();
            }
            if (track.audioElement) {
                if (track.blobUrl) URL.revokeObjectURL(track.blobUrl);
                track.audioElement.src = '';
                track.audioElement = null;
            }
        });

        Object.assign(state, {
            audioContext: null,
            masterGainNode: null,
            masterAnalyserNode: null,
            masterTimeDomainData: null,
            tracks: [],
            isInitialized: false,
            isPlaying: false,
            isAnyTrackSoloed: false,
            maxDuration: 0,
            totalDownloadSize: 0,
            downloadedBytes: 0,
        });

        mixerTracksContainer.innerHTML = '';
        cancelAnimationFrame(state.animationFrameId);

        mainPlayerControls.classList.add('hidden');
        playerProgressContainer.classList.add('hidden');
        progressStatusContainer.classList.remove('hidden');
        loadingText.textContent = '';
        errorText.classList.add('hidden');
        errorIcon.classList.add('hidden');
        playPauseBtn.classList.remove('bg-red-500');
    }

    async function setupNewSongAndLoad(sessionId) {
        mainPlayerControls.classList.remove('hidden');
        masterMeterContainer.classList.add('hidden');

        errorIcon.classList.add('hidden');
        playPauseBtn.classList.remove('bg-red-500');

        updatePlayPauseButton(true);

        errorText.classList.add('hidden');
        loadingText.classList.remove('hidden');

        const tracksData = state.currentSong.tracksData.map(track => ({
            name: track.name,
            file: `${RESOURCE_BASE_URL}/${state.currentSong.folder}/${track.file}`,
            defaultVolume: track.name === '节拍器' ? 50 : 75,
        }));

        createTrackUI(tracksData);

        try {
            await calculateTotalSize(sessionId);
            if (sessionId !== state.loadingSessionId) return;
            await initializeAudio(sessionId);

        } catch (error) {
            if (error.message !== "Session aborted") {
                console.error("Failed to load song:", error);
                if (sessionId === state.loadingSessionId) {
                    handleLoadingError(error);
                }
            } else {
                console.log(`Session ${sessionId} successfully aborted.`);
            }
        }
    }

    // --- Loading & Progress ---

    async function calculateTotalSize(sessionId) {
        if (sessionId !== state.loadingSessionId) throw new Error("Session aborted");
        loadingText.innerHTML = '正在计算音频总大小...';

        const promises = state.tracks.map(track => fetchWithFallback(track.file, {
            method: 'HEAD'
        }, sessionId));
        const results = await Promise.allSettled(promises);

        if (sessionId !== state.loadingSessionId) throw new Error("Session aborted");

        let totalBytes = 0;
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.ok) {
                const size = result.value.headers.get('content-length');
                if (size) totalBytes += parseInt(size, 10);
            } else {
                console.warn("计算某个轨道的大小时失败:", result.reason?.message || result.reason);
            }
        }

        if (totalBytes === 0) {
            console.warn("无法确定总大小，加载进度条可能不准确。");
        }

        state.totalDownloadSize = totalBytes;
        updateLoadingProgress();
    }

    function updateLoadingProgress() {
        if (state.totalDownloadSize > 0) {
            const downloadedMB = (state.downloadedBytes / 1024 / 1024).toFixed(1);
            const totalMB = (state.totalDownloadSize / 1024 / 1024).toFixed(1);
            loadingText.innerHTML = `正在加载音频 (${downloadedMB}/${totalMB}MB)`;
        } else {
            loadingText.innerHTML = '正在加载音频...';
        }
    }

    async function fetchTrackWithProgress(track, sessionId) {
        if (sessionId !== state.loadingSessionId) throw new Error("Session aborted");

        const response = await fetchWithFallback(track.file, {}, sessionId);

        const reader = response.body.getReader();
        const chunks = [];

        while (true) {
            if (sessionId !== state.loadingSessionId) {
                reader.cancel();
                throw new Error("Session aborted");
            }
            const {
                done, value
            } = await reader.read();
            if (done) break;

            chunks.push(value);
            state.downloadedBytes += value.length;
            if (sessionId === state.loadingSessionId) {
                updateLoadingProgress();
            }
        }

        const blob = new Blob(chunks);
        return URL.createObjectURL(blob);
    }

    // --- Audio Processing & Wavesurfer ---

    async function initializeAudio(sessionId) {
        if (sessionId !== state.loadingSessionId) throw new Error("Session aborted");

        state.isInitialized = true;

        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.masterGainNode = state.audioContext.createGain();
        state.masterAnalyserNode = state.audioContext.createAnalyser();
        state.masterAnalyserNode.fftSize = 2048;
        state.masterTimeDomainData = new Float32Array(state.masterAnalyserNode.fftSize);
        state.masterGainNode.connect(state.masterAnalyserNode);
        state.masterAnalyserNode.connect(state.audioContext.destination);

        const loadPromises = state.tracks.map(async (track) => {
            if (sessionId !== state.loadingSessionId) throw new Error("Session aborted");

            const blobUrl = await fetchTrackWithProgress(track, sessionId);
            if (sessionId !== state.loadingSessionId) {
                URL.revokeObjectURL(blobUrl);
                throw new Error("Session aborted");
            }
            track.blobUrl = blobUrl;

            const audioElement = new Audio();
            audioElement.crossOrigin = "anonymous";
            audioElement.src = blobUrl;
            track.audioElement = audioElement;

            const sourceNode = state.audioContext.createMediaElementSource(audioElement);
            const analyserNode = state.audioContext.createAnalyser();
            analyserNode.fftSize = 2048;
            track.analyserNode = analyserNode;
            track.timeDomainData = new Float32Array(analyserNode.fftSize);

            if (track.name === '节拍器') {
                const gainNode = state.audioContext.createGain();
                sourceNode.connect(analyserNode);
                sourceNode.connect(gainNode);
                gainNode.connect(state.masterGainNode);
                track.gainNode = gainNode;
            } else {
                const volumeGainNode = state.audioContext.createGain();
                const muteGainNode = state.audioContext.createGain();

                sourceNode.connect(volumeGainNode);
                volumeGainNode.connect(analyserNode);
                volumeGainNode.connect(muteGainNode);
                muteGainNode.connect(state.masterGainNode);

                track.volumeGainNode = volumeGainNode;
                track.muteGainNode = muteGainNode;
            }

            const metadataPromise = new Promise((resolve, reject) => {
                audioElement.addEventListener('loadedmetadata', () => {
                    if (sessionId !== state.loadingSessionId) return reject(new Error("Session aborted"));
                    if (audioElement.duration > state.maxDuration) {
                        state.maxDuration = audioElement.duration;
                        masterProgress.max = state.maxDuration;
                        totalDurationDisplay.textContent = formatTime(state.maxDuration);
                    }
                    resolve();
                });
            });

            let wavesurferPromise = Promise.resolve();
            if (track.name !== '节拍器') {
                wavesurferPromise = new Promise((resolve, reject) => {
                    if (sessionId !== state.loadingSessionId) return reject(new Error("Session aborted"));
                    track.wavesurfer = WaveSurfer.create({
                        container: track.ui.waveformContainer,
                        waveColor: state.colors.waveColor,
                        progressColor: state.colors.progressColor,
                        height: 60,
                        cursorWidth: 1,
                        cursorColor: state.colors.cursorColor,
                        media: audioElement,
                        interact: true,
                    });
                    track.wavesurfer.on('interaction', (newTime) => seekPlayerTo(newTime));
                    track.wavesurfer.on('ready', resolve);
                    track.wavesurfer.on('error', (err) => reject(err));
                });
            }

            await Promise.all([metadataPromise, wavesurferPromise]);
        });

        loadingText.innerHTML = `正在渲染波形图...`;
        await Promise.all(loadPromises);

        if (sessionId === state.loadingSessionId) {
            allTracksReady();
        }
    }

    function allTracksReady() {
        mixerTracksContainer.classList.remove('opacity-50', 'pointer-events-none');
        masterMeterContainer.classList.remove('hidden');
        playPauseBtn.disabled = false;
        updateAllTrackVolumes();
        updateMasterProgressFill();
        progressStatusContainer.classList.add('hidden');
        playerProgressContainer.classList.remove('hidden');
        play();
    }

    function handleLoadingError(error) {
        loadingIcon.classList.add('hidden');
        loadingText.classList.add('hidden');
        errorText.classList.remove('hidden');
        errorIcon.classList.remove('hidden');
        playPauseBtn.classList.add('bg-red-500');
    }

    function play() {
        if (state.isPlaying) return;
        if (state.audioContext.state === 'suspended') {
            state.audioContext.resume();
        }

        const playPromises = state.tracks.map(track => track.audioElement.play());
        Promise.all(playPromises).then(() => {
            state.isPlaying = true;
            updatePlayPauseButton();
            state.animationFrameId = requestAnimationFrame(updateProgress);
        }).catch(error => {
            if (error.name !== 'AbortError') {
                console.error("Playback failed", error);
            }
        });
    }

    function pause() {
        if (!state.isPlaying) return;
        state.tracks.forEach(track => track.audioElement.pause());
        cancelAnimationFrame(state.animationFrameId);
        state.isPlaying = false;
        updatePlayPauseButton();
    }

    function togglePlayPause() {
        if (!state.isInitialized) return;
        state.isPlaying ? pause() : play();
    }

    // --- UI & Visualization ---

    function createTrackUI(tracksData) {
        mixerTracksContainer.innerHTML = '';
        state.tracks = [];
        mixerTracksContainer.classList.add('opacity-50', 'pointer-events-none');

        tracksData.forEach((trackData) => {
            const isMetronome = trackData.name === '节拍器';
            const {
                trackElement, uiComponents
            } = buildSingleTrackUI(trackData, isMetronome);
            mixerTracksContainer.appendChild(trackElement);

            const track = {
                ...trackData,
                lastVolume: trackData.defaultVolume / 100,
                isMuted: isMetronome,
                isSoloed: false,
                isEffectivelyPlaying: !isMetronome,
                ui: uiComponents,
            };

            state.tracks.push(track);
            bindTrackEvents(track, isMetronome);
            updateVolumeSliderFill(uiComponents.volumeSlider, trackData.defaultVolume);
        });

        const hideAllTooltips = () => state.tracks.forEach(track => hideTooltip(track.ui));
        document.addEventListener('mouseup', hideAllTooltips);
        document.addEventListener('touchend', hideAllTooltips);
    }

    function buildSingleTrackUI(trackData, isMetronome) {
        const trackElement = document.createElement('div');
        trackElement.className = 'py-3';

        const topRow = document.createElement('div');
        topRow.className = 'flex items-center justify-between space-x-4 mb-2';

        const label = document.createElement('label');
        label.textContent = trackData.name;
        label.className = 'text-sm font-bold text-slate-700 w-28 truncate';

        const {
            sliderWrapper, volumeSlider, volumeTooltip
        } = createVolumeSlider(trackData);

        let controlElements, uiComponents = {
            volumeSlider, tooltip: volumeTooltip
        };

        if (isMetronome) {
            const {
                toggleSwitch, toggleInput
            } = createToggleSwitch();
            const {
                meterWrapper, meterBar
            } = createLevelMeter(true);
            controlElements = document.createElement('div');
            controlElements.className = 'flex items-center space-x-2 w-[96px] justify-end';
            controlElements.append(toggleSwitch, meterWrapper);
            Object.assign(uiComponents, {
                toggleInput, meterBar
            });
            topRow.append(label, sliderWrapper, controlElements);
            trackElement.append(topRow);
        } else {
            const {
                soloMuteContainer, muteBtn, soloBtn
            } = createControlButtons();
            controlElements = soloMuteContainer;
            Object.assign(uiComponents, {
                muteBtn, soloBtn
            });

            const bottomRow = document.createElement('div');
            bottomRow.className = 'flex items-center space-x-2';
            const waveformContainer = document.createElement('div');
            waveformContainer.className = 'waveform-container flex-grow';
            const {
                meterWrapper, meterBar
            } = createLevelMeter(false);

            Object.assign(uiComponents, {
                waveformContainer, meterBar
            });

            bottomRow.append(waveformContainer, meterWrapper);
            topRow.append(label, sliderWrapper, controlElements);
            trackElement.append(topRow, bottomRow);
        }

        return {
            trackElement, uiComponents
        };
    }

    function createVolumeSlider(trackData) {
        const sliderWrapper = document.createElement('div');
        sliderWrapper.className = 'volume-slider-wrapper relative flex-grow h-[20px] flex items-center';
        const volumeSlider = document.createElement('input');
        Object.assign(volumeSlider, {
            type: 'range', min: 0, max: 100, value: trackData.defaultVolume
        });
        volumeSlider.className = 'volume-slider w-full';

        const volumeTooltip = document.createElement('div');
        volumeTooltip.className = 'volume-tooltip absolute top-0 bg-slate-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 transition-opacity duration-200';
        volumeTooltip.textContent = `${trackData.defaultVolume}%`;

        sliderWrapper.append(volumeSlider, volumeTooltip);
        return {
            sliderWrapper, volumeSlider, volumeTooltip
        };
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
        return {
            soloMuteContainer, muteBtn, soloBtn
        };
    }

    function createToggleSwitch() {
        const toggleSwitch = document.createElement('label');
        toggleSwitch.className = 'toggle-switch';
        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.className = 'toggle-switch-checkbox';
        const slider = document.createElement('span');
        slider.className = 'toggle-switch-slider';
        toggleSwitch.append(toggleInput, slider);
        return {
            toggleSwitch, toggleInput
        };
    }

    function createLevelMeter(isMetronome = false) {
        const meterWrapper = document.createElement('div');
        meterWrapper.className = isMetronome ? 'vertical-meter-wrapper metronome-meter' : 'vertical-meter-wrapper';
        const meterBar = document.createElement('div');
        meterBar.className = 'vertical-meter-bar';
        meterWrapper.appendChild(meterBar);
        return {
            meterWrapper, meterBar
        };
    }

    // --- Event Binding ---

    function bindTrackEvents(track, isMetronome) {
        const {
            volumeSlider
        } = track.ui;
        volumeSlider.addEventListener('input', e => handleVolumeChange(e, track));
        volumeSlider.addEventListener('mousedown', () => showTooltip(track.ui));
        volumeSlider.addEventListener('touchstart', () => showTooltip(track.ui), {
            passive: true
        });

        if (isMetronome) {
            track.ui.toggleInput.addEventListener('change', () => handleMetronomeToggle(track));
        } else {
            track.ui.muteBtn.addEventListener('click', () => handleMuteClick(track));
            track.ui.soloBtn.addEventListener('click', () => handleSoloClick(track));
        }
    }

    // --- More Event Handlers ---

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

    function handleMetronomeToggle(track) {
        track.isMuted = !track.ui.toggleInput.checked;
        updateAllTrackVolumes();
    }

    function handleMasterProgressInput() {
        showProgressTooltip();
        updateMasterProgressFill();
    }

    function handleMasterProgressChange() {
        hideProgressTooltip();
        seekPlayerTo(parseFloat(masterProgress.value));
    }

    function seekPlayerTo(seekTime) {
        const wasPlaying = state.isPlaying;

        if (wasPlaying) {
            pause();
        }

        state.tracks.forEach(track => {
            track.audioElement.currentTime = seekTime;
        });

        masterProgress.value = seekTime;
        currentTimeDisplay.textContent = formatTime(seekTime);
        updateMasterProgressFill();

        if (wasPlaying) {
            play();
        }
    }

    // --- Volume & Mute/Solo Logic ---

    function updateAllTrackVolumes() {
        if (!state.audioContext) return;

        state.tracks.forEach(track => {
            const isAudible = track.name === '节拍器'
                ? !track.isMuted
                : state.isAnyTrackSoloed
                    ? (track.isSoloed && !track.isMuted)
                    : !track.isMuted;

            if (track.name === '节拍器') {
                if (track.gainNode) {
                    const finalVolume = isAudible ? track.lastVolume : 0;
                    track.gainNode.gain.setTargetAtTime(finalVolume, state.audioContext.currentTime, 0.01);
                }
            } else {
                if (track.volumeGainNode && track.muteGainNode) {
                    track.volumeGainNode.gain.setTargetAtTime(track.lastVolume, state.audioContext.currentTime, 0.01);
                    track.muteGainNode.gain.setTargetAtTime(isAudible ? 1 : 0, state.audioContext.currentTime, 0.01);
                }
            }

            if (track.isEffectivelyPlaying !== isAudible) {
                track.isEffectivelyPlaying = isAudible;
                if (track.wavesurfer) {
                    track.wavesurfer.setOptions({
                        waveColor: isAudible ? state.colors.waveColor : state.colors.waveColorInactive,
                        progressColor: isAudible ? state.colors.progressColor : state.colors.progressColorInactive,
                    });
                }
            }
        });
    }

    // --- Animation & Updates ---

    function updateProgress() {
        if (!state.isPlaying) {
            cancelAnimationFrame(state.animationFrameId);
            return;
        }

        const firstAudio = state.tracks[0]?.audioElement;
        if (!firstAudio) return;
        const currentTime = firstAudio.currentTime;

        for (let i = 1; i < state.tracks.length; i++) {
            const track = state.tracks[i];
            if (track.audioElement) {
                const timeDiff = Math.abs(track.audioElement.currentTime - currentTime);
                // Only correct if the drift is larger than a small threshold (e.g., 100 ms).
                // This prevents excessive seeking which can cause minor audio glitches.
                if (timeDiff > 0.1) {
                    track.audioElement.currentTime = currentTime;
                }
            }
        }

        if (currentTime >= state.maxDuration) {
            pause();
            masterProgress.value = state.maxDuration;
            currentTimeDisplay.textContent = formatTime(state.maxDuration);
        } else {
            if (!state.isSeeking) {
                masterProgress.value = currentTime;
                currentTimeDisplay.textContent = formatTime(currentTime);
                updateMasterProgressFill();
            }
            state.animationFrameId = requestAnimationFrame(updateProgress);
        }
        updateLevelMeters();
        updateMasterLevelMeter();
    }

    function updateLevelMeters() {
        state.tracks.forEach(track => {
            if (!track.analyserNode || !track.ui.meterBar) return;
            updateSingleMeter(track.analyserNode, track.timeDomainData, track.ui.meterBar, track);
        });
    }

    function updateMasterLevelMeter() {
        if (!state.masterAnalyserNode || !masterMeterBar) return;
        updateSingleMeter(state.masterAnalyserNode, state.masterTimeDomainData, masterMeterBar);
    }

    function updateSingleMeter(analyserNode, timeDomainData, meterBar, track = null) {
        const meterWrapper = meterBar.parentElement;
        const isMetronomeMeter = meterWrapper.classList.contains('metronome-meter');
        const rootStyles = getComputedStyle(document.documentElement);

        const MIN_DB = -60.0;
        analyserNode.getFloatTimeDomainData(timeDomainData);
        let peakAmplitude = 0.0;
        for (const sample of timeDomainData) {
            const absSample = Math.abs(sample);
            if (absSample > peakAmplitude) peakAmplitude = absSample;
        }

        if (peakAmplitude === 0) {
            if (isMetronomeMeter) {
                meterWrapper.style.backgroundColor = rootStyles.getPropertyValue('--progress-track-bg').trim();
            } else {
                meterBar.style.height = '0%';
            }
            return;
        }

        const peakDb = 20 * Math.log10(peakAmplitude);
        const levelPercent = peakDb < MIN_DB ? 0 : Math.min(100, Math.max(0, ((((peakDb - MIN_DB) / -MIN_DB) ** 2) * 100) | 0));

        if (isMetronomeMeter) {
            const isMuted = !track.ui.toggleInput.checked;
            let finalColor = rootStyles.getPropertyValue('--progress-track-bg').trim();
            if (levelPercent > 85) {
                finalColor = isMuted ? state.colors.meterColorInactiveMetronome : state.colors.meterColorMetronome;
            }
            meterWrapper.style.backgroundColor = finalColor;
            meterBar.style.height = '0%';
        } else {
            const isActive = track ? track.isEffectivelyPlaying : true;
            meterBar.style.backgroundColor = isActive ? state.colors.meterColor : state.colors.meterColorInactive;
            meterBar.style.height = `${levelPercent}%`;
        }
    }

    // --- UI Update Functions ---

    function updatePlayPauseButton(isLoading = false) {
        if (isLoading) {
            playPauseBtn.disabled = true;
            playIcon.classList.add('hidden');
            pauseIcon.classList.add('hidden');
            loadingIcon.classList.remove('hidden');
            progressStatusContainer.classList.remove('hidden');
            playerProgressContainer.classList.add('hidden');
            return;
        }
        playPauseBtn.disabled = false;
        loadingIcon.classList.add('hidden');
        playIcon.classList.toggle('hidden', state.isPlaying);
        pauseIcon.classList.toggle('hidden', !state.isPlaying);

        if (state.isPlaying) {
            playPauseBtn.classList.replace('bg-blue-500', 'bg-amber-500');
            playPauseBtn.classList.replace('hover:bg-blue-600', 'hover:bg-amber-600');
        } else {
            playPauseBtn.classList.replace('bg-amber-500', 'bg-blue-500');
            playPauseBtn.classList.replace('hover:bg-amber-600', 'hover:bg-blue-600');
        }
    }

    function updateVolumeSliderFill(slider, value) {
        const percent = Math.max(0, Math.min(100, value));
        const wrapper = slider.parentElement;
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

    // --- Tooltips ---

    function showTooltip(ui) {
        ui.tooltip.style.opacity = '1';
        updateTooltip(ui);
    }

    function hideTooltip(ui) {
        ui.tooltip.style.opacity = '0';
    }

    function updateTooltip(ui) {
        const slider = ui.volumeSlider;
        const value = slider.value;
        ui.tooltip.textContent = `${value}%`;
        const thumbWidth = 20;
        const trackWidth = slider.parentElement.offsetWidth;
        const percent = value / 100;
        let thumbPosition = percent * (trackWidth - thumbWidth) + (thumbWidth / 2);
        const tooltipWidth = ui.tooltip.offsetWidth;
        thumbPosition = Math.max(tooltipWidth / 2, Math.min(thumbPosition, trackWidth - tooltipWidth / 2));
        ui.tooltip.style.left = `${thumbPosition}px`;
    }

    function showProgressTooltip() {
        progressTooltip.style.opacity = '1';
        updateProgressTooltip();
    }

    function hideProgressTooltip() {
        progressTooltip.style.opacity = '0';
    }

    function updateProgressTooltip() {
        if (!progressTooltip) return;
        const val = masterProgress.value;
        progressTooltip.textContent = formatTime(val);

        const trackWidth = masterProgress.offsetWidth;
        const thumbWidth = 16;
        const percent = val / masterProgress.max;

        let thumbPosition = percent * (trackWidth - thumbWidth) + (thumbWidth / 2);
        const tooltipWidth = progressTooltip.offsetWidth;
        const left = Math.max(0, thumbPosition - tooltipWidth / 2);

        progressTooltip.style.left = `${Math.min(left, trackWidth - tooltipWidth)}px`;
    }

    // --- Utilities ---

    function formatTime(seconds) {
        const secs = Math.floor(seconds);
        const minutes = Math.floor(secs / 60);
        const remainingSeconds = secs % 60;
        return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    initialize();
});