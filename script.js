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

    // --- SVG 图标 ---
    const ICONS = {
        unmuted: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"></path></svg>`,
        muted: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="text-red-500"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"></path></svg>`
    };

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
        // 音轨区域初始禁用（灰色且不可操作）
        mixerTracksContainer.classList.add('opacity-50', 'pointer-events-none');
        tracksData.forEach((trackData) => {
            const trackElement = document.createElement('div');
            trackElement.className = 'py-4';
            const labelAndMuteContainer = document.createElement('div');
            labelAndMuteContainer.className = 'flex justify-between items-center';
            const label = document.createElement('label');
            label.textContent = trackData.name;
            label.className = 'text-sm font-bold text-gray-700';
            const muteBtn = document.createElement('button');
            muteBtn.className = 'text-gray-400 hover:text-gray-600 transition-colors';
            // 设置初始静音图标
            muteBtn.innerHTML = (trackData.defaultVolume === 0) ? ICONS.muted : ICONS.unmuted;
            labelAndMuteContainer.appendChild(label);
            labelAndMuteContainer.appendChild(muteBtn);
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
            trackElement.appendChild(labelAndMuteContainer);
            trackElement.appendChild(controlsContainer);
            mixerTracksContainer.appendChild(trackElement);
            tracks.push({ ...trackData, isMuted: trackData.defaultVolume === 0, lastVolume: trackData.defaultVolume / 100, ui: { volumeSlider, muteBtn, tooltip: volumeTooltip, meterBar } });
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
                gainNode.gain.value = track.isMuted ? 0 : track.lastVolume;
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
            if (!track.file) {
                throw new Error(`轨道 "${track.name}" 的文件路径未设置。`);
            }
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
    }

    /**
     * @function calculateTotalSize
     * @description 使用 HEAD 请求获取所有音频文件的总大小并更新UI
     * @param {string} extension - 文件扩展名 ('ogg' 或 'm4a')
     * @param {HTMLElement} spanElement - 用于显示大小的 span 元素
     * @returns {Promise<number>} 文件总大小（字节）
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
     * @param {'hq' | 'lq'} quality - 音频质量 ('hq' or 'lq')
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
        if (audioContext.state === 'suspended') audioContext.resume();
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
        cancelAnimationFrame(animationFrameId);

        tracks.forEach(track => {
            if (track.sourceNode) {
                track.sourceNode.stop(0);
                track.sourceNode.disconnect();
                track.sourceNode = null;
            }
        });

        isPlaying = false;
        startOffset += audioContext.currentTime - startTime;
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
        startOffset = seekTime;
        currentTimeDisplay.textContent = formatTime(seekTime);
        if (isPlaying) {
            pause();
            play();
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
            let levelPercent;
            if (peakDb < MIN_DB) {
                levelPercent = 0;
            } else {
                levelPercent = ((((peakDb - MIN_DB) / (0 - MIN_DB)) ** 2) * 100) | 0;
            }
            meterBar.style.width = `${Math.min(100, Math.max(0, levelPercent))}%`;
        });
    }

    /**
     * @function updateProgress
     * @description 使用 requestAnimationFrame 循环更新主进度条和时间显示
     */
    function updateProgress() {
        if (!isPlaying) return;
        const elapsed = audioContext.currentTime - startTime;
        const newCurrentTime = startOffset + elapsed;
        if (newCurrentTime >= minDuration) {
            pause();
            startOffset = minDuration;
            masterProgress.value = minDuration;
        } else {
            if (!isSeeking) {
                masterProgress.value = newCurrentTime;
                currentTimeDisplay.textContent = formatTime(newCurrentTime);
            }
            animationFrameId = requestAnimationFrame(updateProgress);
        }
        updateLevelMeters();
    }

    /**
     * @function bindUIEvents
     * @description 绑定所有 UI 元素的事件监听器
     */
    function bindUIEvents() {
        playPauseBtn.addEventListener('click', togglePlayPause);
        masterProgress.addEventListener('input', () => { isSeeking = true; });
        masterProgress.addEventListener('change', () => { isSeeking = false; seek(); });
        tracks.forEach((track) => {
            track.ui.volumeSlider.addEventListener('input', e => handleVolumeChange(e, track));
            track.ui.muteBtn.addEventListener('click', () => toggleMute(track));
            track.ui.volumeSlider.addEventListener('mousedown', () => showTooltip(track.ui));
            track.ui.volumeSlider.addEventListener('touchstart', () => showTooltip(track.ui), { passive: true });
            track.ui.volumeSlider.addEventListener('input', () => updateTooltip(track.ui));
        });
        const hideAllTooltips = () => { tracks.forEach(track => hideTooltip(track.ui)); };
        document.addEventListener('mouseup', hideAllTooltips);
        document.addEventListener('touchend', hideAllTooltips);
    }

    /**
     * @function handleVolumeChange
     * @description 处理音量滑块的变化
     */
    function handleVolumeChange(e, track) {
        const value = parseFloat(e.target.value);
        const volume = value / 100;
        if (track.gainNode) track.gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        track.isMuted = (value === 0);
        if (volume > 0) track.lastVolume = volume;
        else track.lastVolume = 0;
        updateMuteVisuals(track);
        updateVolumeSliderFill(track.ui.volumeSlider, value);
    }

    /**
     * @function toggleMute
     * @description 切换音轨的静音状态
     */
    function toggleMute(track) {
        track.isMuted = !track.isMuted;
        if (track.gainNode) {
            if (track.isMuted) {
                track.gainNode.gain.setValueAtTime(0, audioContext.currentTime);
            } else {
                const volumeToRestore = track.lastVolume > 0 ? track.lastVolume : 0.75;
                track.gainNode.gain.setValueAtTime(volumeToRestore, audioContext.currentTime);
                track.ui.volumeSlider.value = volumeToRestore * 100;
                updateVolumeSliderFill(track.ui.volumeSlider, volumeToRestore * 100);
            }
        }
        updateMuteVisuals(track);
    }
    /**
     * @function updatePlayPauseButton
     * @description 更新播放/暂停按钮的图标和颜色
     */
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
    /**
     * @function updateMuteVisuals
     * @description 更新静音按钮的图标和滑块的透明度
     */
    function updateMuteVisuals(track) {
        track.ui.muteBtn.innerHTML = track.isMuted ? ICONS.muted : ICONS.unmuted;
        track.ui.volumeSlider.style.opacity = track.isMuted ? '0.5' : '1';
        if (!track.gainNode) track.ui.muteBtn.innerHTML = (track.defaultVolume > 0) ? ICONS.unmuted : ICONS.muted;
    }
    /**
     * @function updateVolumeSliderFill
     * @description 更新音量滑块的背景填充比例
     */
    function updateVolumeSliderFill(slider, value) { slider.style.backgroundSize = `${value}% 100%`; }
    /**
     * @function formatTime
     * @description 将秒数格式化为 mm:ss 格式
     */
    function formatTime(seconds) {
        const secs = Math.floor(seconds);
        const minutes = Math.floor(secs / 60);
        const remainingSeconds = secs % 60;
        return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }
    /**
     * @function showTooltip
     * @description 显示音量提示框
     */
    function showTooltip(ui) { ui.tooltip.style.opacity = '1'; updateTooltip(ui); }
    /**
     * @function updateTooltip
     * @description 更新音量提示框的内容和位置
     */
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
    /**
     * @function hideTooltip
     * @description 隐藏音量提示框
     */
    function hideTooltip(ui) { ui.tooltip.style.opacity = '0'; }

    // --- 初始化执行 ---
    function initialize() {
        // 初始只显示歌曲选择
        qualitySelectionContainer.classList.add('hidden');
        mainPlayerControls.classList.add('hidden');
        mixerTracksContainer.innerHTML = '';
        loadSongsList();
        loadHqBtn.addEventListener('click', () => startLoading('hq'));
        loadLqBtn.addEventListener('click', () => startLoading('lq'));
    }

    initialize();
});