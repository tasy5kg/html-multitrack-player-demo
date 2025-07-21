// 选择歌曲后隐藏下拉菜单并显示歌曲名
document.addEventListener('DOMContentLoaded', function () {
    const songSelect = document.getElementById('song-select');
    const selectedSongName = document.getElementById('selected-song-name');
    if (songSelect && selectedSongName) {
        songSelect.addEventListener('change', function () {
            const selectedOption = songSelect.options[songSelect.selectedIndex];
            if (selectedOption && selectedOption.value) {
                // 隐藏下拉菜单
                songSelect.classList.add('hidden');
                // 显示歌曲名
                selectedSongName.textContent = selectedOption.textContent;
                selectedSongName.classList.remove('hidden');
            }
        });
    }
});
// 等待 DOM 内容完全加载后执行脚本
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM 元素 ---
    const mixerTracksContainer = document.getElementById('mixer-tracks');
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
    const qualitySelectionContainer = document.getElementById('quality-selection-container');
    const mainPlayerControls = document.getElementById('main-player-controls');
    const loadHqBtn = document.getElementById('load-hq-btn');
    const loadLqBtn = document.getElementById('load-lq-btn');
    const hqSizeSpan = document.getElementById('hq-size');
    const lqSizeSpan = document.getElementById('lq-size');
    const songSelect = document.getElementById('song-select');
    const songSelectionContainer = document.getElementById('song-selection-container');

    // --- 全局状态 ---
    let audioContext;
    let tracks = [];
    let isInitialized = false;
    let isPlaying = false;
    let isSeeking = false;
    let startTime = 0;
    let startOffset = 0;
    let minDuration = Infinity;
    let animationFrameId;
    let totalDownloadSize = 0;
    let storedHqBytes = 0;
    let storedLqBytes = 0;
    let songsList = [];
    let currentSong = null;
    let tracksData = [];
    let resizeObserver = null;


    // --- SVG 图标 ---
    // 已移除静音图标

    // --- 歌曲选择相关 ---
    async function loadSongsList() {
        try {
            const res = await fetch('songs.json');
            songsList = await res.json();
            songSelect.innerHTML = '<option value="" selected disabled>请选择歌曲</option>';
            songsList.forEach((song, idx) => {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = song.name;
                songSelect.appendChild(opt);
            });
        } catch (e) {
            songSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }

    songSelect.addEventListener('change', () => {
        const idx = songSelect.value;
        if (songsList[idx]) {
            currentSong = songsList[idx];
            tracksData = currentSong.tracksData.map(track => ({
                name: track.name,
                baseName: track.file,
                defaultVolume: track.name === '节拍器' ? 0 : 75,
                folder: currentSong.folder
            }));
            qualitySelectionContainer.classList.remove('hidden');
            mainPlayerControls.classList.add('hidden');
            mixerTracksContainer.innerHTML = '';
            isInitialized = false;

            if (resizeObserver) {
                resizeObserver.disconnect();
                resizeObserver = null;
            }

            tracks = [];
            hqSizeSpan.textContent = '（计算中…）';
            lqSizeSpan.textContent = '（计算中…）';
            [storedHqBytes, storedLqBytes] = [0, 0];
            (async () => {
                [storedHqBytes, storedLqBytes] = await Promise.all([
                    calculateTotalSize('ogg', hqSizeSpan),
                    calculateTotalSize('m4a', lqSizeSpan)
                ]);
                loadHqBtn.disabled = false;
                loadLqBtn.disabled = false;
            })();
            setupUI();
            bindUIEvents();
        }
    });

    // --- 动态生成音轨 UI ---
    function setupUI() {
        mixerTracksContainer.innerHTML = '';
        tracks = [];
        mixerTracksContainer.classList.add('opacity-50', 'pointer-events-none');
        tracksData.forEach((trackData) => {
            const trackElement = document.createElement('div');
            trackElement.className = 'py-4';
            const labelContainer = document.createElement('div');
            labelContainer.className = 'flex items-center';
            const label = document.createElement('label');
            label.textContent = trackData.name;
            label.className = 'text-sm font-bold text-gray-700';
            labelContainer.appendChild(label);
            const controlsContainer = document.createElement('div');
            controlsContainer.className = 'flex items-center space-x-2 mt-2';
            const sliderWrapper = document.createElement('div');
            sliderWrapper.className = 'relative w-3/4 h-[20px] flex items-center';
            const volumeSlider = document.createElement('input');
            volumeSlider.type = 'range';
            volumeSlider.min = 0;
            volumeSlider.max = 100;
            volumeSlider.value = trackData.defaultVolume;
            volumeSlider.className = `volume-slider w-full ${trackData.name === '节拍器' ? 'metronome' : ''}`;
            const volumeTooltip = document.createElement('div');
            volumeTooltip.className = 'volume-tooltip absolute top-0 bg-gray-800 text-white text-xs rounded py-1 px-2 pointer-events-none opacity-0 transition-opacity duration-200';
            volumeTooltip.textContent = `${trackData.defaultVolume}%`;
            sliderWrapper.appendChild(volumeSlider);
            sliderWrapper.appendChild(volumeTooltip);
            const meterWrapper = document.createElement('div');
            meterWrapper.className = 'w-1/4 h-[20px] flex items-center';
            const meterContainer = document.createElement('div');
            meterContainer.className = 'w-full h-2 bg-gray-200 rounded-full overflow-hidden';
            const meterBar = document.createElement('div');
            meterBar.className = 'h-full rounded-full bg-green-500 transition-width duration-100 ease-out';
            meterBar.style.width = '0%';
            meterContainer.appendChild(meterBar);
            meterWrapper.appendChild(meterContainer);
            controlsContainer.appendChild(sliderWrapper);
            controlsContainer.appendChild(meterWrapper);

            const waveformContainer = document.createElement('div');
            waveformContainer.className = 'waveform-container';

            trackElement.appendChild(labelContainer);
            trackElement.appendChild(controlsContainer);
            trackElement.appendChild(waveformContainer);
            mixerTracksContainer.appendChild(trackElement);

            tracks.push({ ...trackData, lastVolume: trackData.defaultVolume / 100, ui: { volumeSlider, tooltip: volumeTooltip, meterBar, waveformContainer } });
        });
    }

    /**
     * @function initializeAudio
     * @description 初始化 Web Audio API，创建音频节点，并加载所有音轨
     */
    async function initializeAudio() {
        isInitialized = true;
        playPauseBtn.disabled = true;
        playIcon.classList.add('hidden');
        loadingIcon.classList.remove('hidden');
        loadingText.innerHTML = `正在加载音频资源（<span id="load-progress-percent">0</span>%）`;

        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            tracks.forEach(track => {
                const gainNode = audioContext.createGain();
                gainNode.gain.value = track.lastVolume;
                const analyserNode = audioContext.createAnalyser();
                analyserNode.fftSize = 2048;
                gainNode.connect(analyserNode);
                analyserNode.connect(audioContext.destination);
                track.gainNode = gainNode;
                track.analyserNode = analyserNode;
                track.timeDomainData = new Float32Array(analyserNode.fftSize);
            });

            await loadAudioTracksWithProgress();
            mixerTracksContainer.classList.remove('opacity-50', 'pointer-events-none');
            playPauseBtn.disabled = false;

            initializeResizeObserver();

            play();

        } catch (error) {
            console.error("音频初始化失败：", error);
            loadingIcon.classList.add('hidden');
            loadingText.classList.add('hidden');
            errorText.classList.remove('hidden');
            errorIcon.classList.remove('hidden');
            playPauseBtn.classList.add('bg-red-500');
        }
    }

    /**
     * @function loadAudioTracksWithProgress
     * @description 使用 Fetch API 流式加载音频文件，并实时更新加载进度
     */
    async function loadAudioTracksWithProgress() {
        let loadedBytes = 0;
        const loadProgressPercentSpan = document.getElementById('load-progress-percent');

        const loadPromises = tracks.map(async (track) => {
            if (!track.file) throw new Error(`轨道 "${track.name}" 的文件路径未设置。`);
            const response = await fetch(track.file);
            if (!response.ok) throw new Error(`无法加载 ${track.file}`);
            if (!response.body) throw new Error('浏览器不支持流式读取');

            const reader = response.body.getReader();
            const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loadedBytes += value.length;
                if (totalDownloadSize > 0) {
                    const percent = Math.min(100, Math.round((loadedBytes / totalDownloadSize) * 100));
                    if (loadProgressPercentSpan) loadProgressPercentSpan.textContent = percent;
                }
            }
            const blob = new Blob(chunks);
            const arrayBuffer = await blob.arrayBuffer();
            track.audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            track.waveformData = generateWaveformData(track.audioBuffer);

            return track.audioBuffer.duration;
        });

        const results = await Promise.allSettled(loadPromises);
        const successfulLoads = results.filter(r => r.status === 'fulfilled').map(r => r.value);

        if (results.some(r => r.status === 'rejected')) {
            const failed = results.find(r => r.status === 'rejected');
            throw new Error(`加载失败: ${failed.reason.message}`);
        }

        minDuration = Math.min(...successfulLoads);
        masterProgress.max = minDuration;
        totalDurationDisplay.textContent = formatTime(minDuration);
        progressStatusContainer.classList.add('hidden');
        playerProgressContainer.classList.remove('hidden');

        tracks.forEach(track => {
            drawWaveform(track);
        });
    }

    /**
     * @function generateWaveformData
     * @description 根据音频数据生成精确的波形数据点
     */
    function generateWaveformData(audioBuffer) {
        const sampleInterval = 0.1;
        const numberOfChannels = audioBuffer.numberOfChannels;
        const channelsData = Array.from({ length: numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));
        const sampleRate = audioBuffer.sampleRate;
        const samplesPerPoint = Math.floor(sampleRate * sampleInterval);
        const pointsCount = Math.floor(audioBuffer.duration / sampleInterval);
        const waveformPoints = [];

        for (let i = 0; i < pointsCount; i++) {
            const start = i * samplesPerPoint;
            const end = Math.min(start + samplesPerPoint, audioBuffer.length);
            let min = 1.0;
            let max = -1.0;

            for (let j = start; j < end; j++) {
                for (let channel = 0; channel < numberOfChannels; channel++) {
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
     * @function drawWaveform
     * @description 使用预先计算好的数据绘制单个音轨的波形图
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
            const point = waveformData[i];
            const y1 = halfHeight - (point.max * halfHeight);
            pathData += ` L ${i} ${y1}`;
        }
        for (let i = waveformData.length - 1; i >= 0; i--) {
            const point = waveformData[i];
            const y2 = halfHeight - (point.min * halfHeight);
            pathData += ` L ${i} ${y2}`;
        }
        pathData += ' Z';

        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute('class', 'waveform-svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('preserveAspectRatio', 'none');

        const path = document.createElementNS(svgNS, "path");
        path.setAttribute('d', pathData);
        path.setAttribute('fill', '#10B981');
        path.setAttribute('stroke', 'none');

        const baseline = document.createElementNS(svgNS, "line");
        baseline.setAttribute('x1', '0');
        baseline.setAttribute('y1', halfHeight.toString());
        baseline.setAttribute('x2', width.toString());
        baseline.setAttribute('y2', halfHeight.toString());
        baseline.setAttribute('class', 'waveform-baseline');

        const progressLine = document.createElementNS(svgNS, "line");
        progressLine.setAttribute('x1', '0');
        progressLine.setAttribute('y1', '0');
        progressLine.setAttribute('x2', '0');
        progressLine.setAttribute('y2', height.toString());
        progressLine.setAttribute('class', 'waveform-progress-line');
        track.ui.progressLine = progressLine;

        svg.appendChild(path);
        svg.appendChild(baseline);
        svg.appendChild(progressLine);
        container.innerHTML = '';
        container.appendChild(svg);

        updateWaveformProgressLine(startOffset);

        if (!container.dataset.hasClickListener) {
            container.addEventListener('click', (e) => {
                const rect = container.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const seekTime = (clickX / rect.width) * minDuration;

                if (isPlaying) {
                    pause();
                    startOffset = seekTime;
                    play();
                } else {
                    startOffset = seekTime;
                    masterProgress.value = seekTime;
                    currentTimeDisplay.textContent = formatTime(seekTime);
                    updateWaveformProgressLine(seekTime);
                }
            });
            container.dataset.hasClickListener = 'true';
        }
    }

    /**
     * @function initializeResizeObserver
     * @description 监听波形图容器尺寸变化并重绘
     */
    function initializeResizeObserver() {
        if (resizeObserver) resizeObserver.disconnect();

        resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                const currentTime = startOffset + (isPlaying ? (audioContext.currentTime - startTime) : 0);
                updateWaveformProgressLine(currentTime);
            });
        });

        tracks.forEach(track => {
            if (track.ui.waveformContainer) {
                resizeObserver.observe(track.ui.waveformContainer);
            }
        });
    }

    /**
     * @function calculateTotalSize
     * @description 使用 HEAD 请求获取所有音频文件的总大小并更新UI
     */
    async function calculateTotalSize(extension, spanElement) {
        let totalBytes = 0;
        try {
            const promises = tracksData.map(track => {
                const url = `${track.folder}/${track.baseName}.${extension}`;
                return fetch(url, { method: 'HEAD' });
            });
            const results = await Promise.allSettled(promises);
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value.ok) {
                    const size = result.value.headers.get('content-length');
                    if (size) totalBytes += parseInt(size, 10);
                }
            }
            if (totalBytes > 0) {
                const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                spanElement.textContent = `（${totalMB}MB）`;
            } else {
                spanElement.textContent = `（未知大小）`;
            }
        } catch (error) {
            console.warn(`无法获取 ${extension} 文件总大小：`, error);
            spanElement.textContent = `（获取失败）`;
        }
        return totalBytes;
    }

    /**
     * @function startLoading
     * @description 用户选择质量后开始加载流程
     */
    function startLoading(quality) {
        qualitySelectionContainer.classList.add('hidden');
        mainPlayerControls.classList.remove('hidden');
        const extension = quality === 'hq' ? 'ogg' : 'm4a';
        tracks.forEach(track => {
            track.file = `${track.folder}/${track.baseName}.${extension}`;
        });
        totalDownloadSize = (quality === 'hq') ? storedHqBytes : storedLqBytes;
        initializeAudio();
    }

    /**
     * @function play
     * @description 开始或继续播放所有音轨
     */
    function play() {
        if (isPlaying) return;
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        if (startOffset >= minDuration) startOffset = 0;

        tracks.forEach(track => {
            const source = audioContext.createBufferSource();
            source.buffer = track.audioBuffer;
            source.connect(track.gainNode);
            source.start(0, startOffset);
            track.sourceNode = source;
        });

        isPlaying = true;
        startTime = audioContext.currentTime;
        updatePlayPauseButton();
        animationFrameId = requestAnimationFrame(updateProgress);
    }
    /**
     * @function pause
     * @description 暂停播放所有音轨
     */
    function pause() {
        if (!isPlaying) return;
        const elapsed = audioContext.currentTime - startTime;
        cancelAnimationFrame(animationFrameId);

        tracks.forEach(track => {
            if (track.sourceNode) {
                try {
                    track.sourceNode.stop(0);
                    track.sourceNode.disconnect();
                } catch (e) { /* 已经停止则忽略 */ }
                track.sourceNode = null;
            }
        });

        isPlaying = false;
        startOffset += elapsed;
        updatePlayPauseButton();
    }
    /**
     * @function togglePlayPause
     * @description 切换播放/暂停状态
     */
    function togglePlayPause() { if (isPlaying) pause(); else play(); }

    /**
     * @function seek
     * @description 跳转到指定时间点
     */
    function seek() {
        const seekTime = parseFloat(masterProgress.value);
        if (isPlaying) {
            pause();
            startOffset = seekTime;
            play();
        } else {
            startOffset = seekTime;
            currentTimeDisplay.textContent = formatTime(seekTime);
            updateWaveformProgressLine(seekTime);
        }
    }

    /**
     * @function updateLevelMeters
     * @description 更新所有音轨的实时音频电平表
     */
    function updateLevelMeters() {
        const MIN_DB = -60.0;
        tracks.forEach(track => {
            const meterBar = track.ui.meterBar;
            if (!track.analyserNode || !meterBar) return;
            track.analyserNode.getFloatTimeDomainData(track.timeDomainData);
            let peakAmplitude = 0.0;
            for (const sample of track.timeDomainData) {
                const absSample = Math.abs(sample);
                if (absSample > peakAmplitude) peakAmplitude = absSample;
            }
            if (peakAmplitude === 0) {
                meterBar.style.width = '0%';
                return;
            }
            const peakDb = 20 * Math.log10(peakAmplitude);
            let levelPercent = peakDb < MIN_DB ? 0 : ((((peakDb - MIN_DB) / (0 - MIN_DB)) ** 2) * 100) | 0;
            meterBar.style.width = `${Math.min(100, Math.max(0, levelPercent))}%`;
        });
    }

    /**
     * @function updateProgress
     * @description 使用 requestAnimationFrame 循环更新主进度条和时间显示
     */
    function updateProgress() {
        if (!isPlaying) {
            cancelAnimationFrame(animationFrameId);
            return;
        };

        // --- 最终修复：结合音频延迟进行校正 ---
        const latency = audioContext.outputLatency || 0;
        const newCurrentTime = startOffset + (audioContext.currentTime - startTime) - latency;

        if (newCurrentTime >= minDuration) {
            pause();
            startOffset = minDuration;
            masterProgress.value = minDuration;
            currentTimeDisplay.textContent = formatTime(minDuration);
            updateWaveformProgressLine(minDuration);
        } else {
            if (!isSeeking) {
                masterProgress.value = newCurrentTime;
                currentTimeDisplay.textContent = formatTime(newCurrentTime);
                updateWaveformProgressLine(newCurrentTime);
            }
            animationFrameId = requestAnimationFrame(updateProgress);
        }
        updateLevelMeters();
    }

    /**
     * @function updateWaveformProgressLine
     * @description 更新所有波形图上的红色播放进度线
     * @param {number} currentTime - 当前播放时间
     */
    function updateWaveformProgressLine(currentTime) {
        tracks.forEach(track => {
            if (track.ui.progressLine && track.waveformData && track.audioBuffer) {
                const trackDuration = track.audioBuffer.duration;
                const progressPercent = Math.max(0, Math.min(1, currentTime / trackDuration));
                const xPos = progressPercent * track.waveformData.length;
                track.ui.progressLine.setAttribute('transform', `translate(${xPos}, 0)`);

                if (currentTime >= trackDuration) {
                    track.ui.progressLine.style.display = 'none';
                } else {
                    track.ui.progressLine.style.display = 'block';
                }
            }
        });
    }

    // --- 其他 UI 事件函数 (无需修改) ---
    function bindUIEvents() {
        playPauseBtn.addEventListener('click', togglePlayPause);
        masterProgress.addEventListener('input', () => { isSeeking = true; });
        masterProgress.addEventListener('change', () => { isSeeking = false; seek(); });
        tracks.forEach((track) => {
            track.ui.volumeSlider.addEventListener('input', e => handleVolumeChange(e, track));
            track.ui.volumeSlider.addEventListener('mousedown', () => showTooltip(track.ui));
            track.ui.volumeSlider.addEventListener('touchstart', () => showTooltip(track.ui), { passive: true });
            track.ui.volumeSlider.addEventListener('input', () => updateTooltip(track.ui));
        });
        const hideAllTooltips = () => { tracks.forEach(track => hideTooltip(track.ui)); };
        document.addEventListener('mouseup', hideAllTooltips);
        document.addEventListener('touchend', hideAllTooltips);
    }
    function handleVolumeChange(e, track) {
        const value = parseFloat(e.target.value);
        const volume = value / 100;
        if (track.gainNode) track.gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        track.lastVolume = volume;
        updateVolumeSliderFill(track.ui.volumeSlider, value);
    }
    // 已移除 toggleMute 相关逻辑
    function updatePlayPauseButton() {
        loadingIcon.classList.add('hidden');
        playIcon.classList.toggle('hidden', isPlaying);
        pauseIcon.classList.toggle('hidden', !isPlaying);
        if (isPlaying) {
            playPauseBtn.classList.replace('bg-blue-500', 'bg-amber-500');
            playPauseBtn.classList.replace('hover:bg-blue-600', 'hover:bg-amber-600');
        } else {
            playPauseBtn.classList.replace('bg-amber-500', 'bg-blue-500');
            playPauseBtn.classList.replace('hover:bg-amber-600', 'hover:bg-blue-600');
        }
    }
    // 已移除 updateMuteVisuals 相关逻辑
    function updateVolumeSliderFill(slider, value) { slider.style.backgroundSize = `${value}% 100%`; }
    function formatTime(seconds) {
        const secs = Math.floor(seconds);
        const minutes = Math.floor(secs / 60);
        const remainingSeconds = secs % 60;
        return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }
    function showTooltip(ui) { ui.tooltip.style.opacity = '1'; updateTooltip(ui); }
    function updateTooltip(ui) {
        const slider = ui.volumeSlider;
        const value = slider.value;
        ui.tooltip.textContent = `${value}%`;
        const thumbWidth = 20;
        const trackWidth = slider.parentElement.offsetWidth;
        const percent = value / 100;
        let thumbPosition = percent * (trackWidth - thumbWidth) + (thumbWidth / 2);
        thumbPosition = Math.max(ui.tooltip.offsetWidth / 2, Math.min(thumbPosition, trackWidth - ui.tooltip.offsetWidth / 2));
        ui.tooltip.style.left = `${thumbPosition}px`;
    }
    function hideTooltip(ui) { ui.tooltip.style.opacity = '0'; }

    // --- 初始化执行 ---
    function initialize() {
        qualitySelectionContainer.classList.add('hidden');
        mainPlayerControls.classList.add('hidden');
        mixerTracksContainer.innerHTML = '';
        loadSongsList();
        loadHqBtn.addEventListener('click', () => startLoading('hq'));
        loadLqBtn.addEventListener('click', () => startLoading('lq'));
    }

    initialize();
});