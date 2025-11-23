import * as THREE from 'three';
import { SurroundContext } from './surround-sound-context.js';

export class SurroundController {
    constructor(roomWidth = 50, roomHeight = 70, roomDepth = 50) {
        this.ctx = new SurroundContext(window, roomWidth, roomHeight, roomDepth);
        this.audioContext = this.ctx.audioContext;

        this.sources = new Map();
        this.particleSystem = null;
        this.camera = null;
        
        this.currentMode = 'main';
        this._seqActive = false;
        this._seqIdx = 0;
        this._seqGapMs = 5000;
        this._seqTimer = null;
        this._currentId = null;
        this._dragPlayingIds = new Set();
        this._activeOneShotId = null;
        this._highlighted = new Map();
        this._highlightRoots = new Set();
        this._highlightById = new Map();
        this._autoHighlightedIds = new Set();
        this.sequenceFadeInMs = 450;
        this.sequenceFadeOutMs = 800;
        this._userRequestedPlay = false;
        this._activeOneShotIds = new Set();
        
        // ADDED: Store pending solutions for reloading when mode changes
        this._pendingSolutions = null;
        
        // ADDED: Store last sequence index to resume from same position
        this._lastSeqIdx = 0;

        // Animation loop for updating positions and listener
        this._animationFrameId = null;
        this._startPositionUpdateLoop();
        
        console.log(`🎵 SurroundController initialized with Web Audio 3D spatialization`);
    }

    setCamera(camera) {
        this.camera = camera;
        console.log(`🎥 Camera set for audio listener tracking`);
        
        if (this.camera) {
            this._updateListenerFromCamera();
        }
    }

    _updateListenerFromCamera() {
        if (!this.camera) return;
        
        this.ctx.setListenerPosition(
            this.camera.position.x,
            this.camera.position.y,
            this.camera.position.z
        );
        
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);
        
        const cameraUp = new THREE.Vector3(0, 1, 0);
        cameraUp.applyQuaternion(this.camera.quaternion);
        
        this.ctx.setListenerOrientation(
            cameraDirection.x,
            cameraDirection.y,
            cameraDirection.z,
            cameraUp.x,
            cameraUp.y,
            cameraUp.z
        );
    }

    _startPositionUpdateLoop() {
        const update = () => {
            this._updateListenerFromCamera();
            
            for (const [id, sourceData] of this.sources) {
                if (sourceData.spatialSource?.isPlaying && sourceData.spatialSource?.isSpatial) {
                    const solid = this._getSolidRootForId(id);
                    if (solid) {
                        sourceData.spatialSource.setPosition(
                            solid.position.x,
                            solid.position.y,
                            solid.position.z
                        );
                    }
                }
            }
            this._animationFrameId = requestAnimationFrame(update);
        };
        this._animationFrameId = requestAnimationFrame(update);
    }

    setParticleSystem(particleSystem) {
        this.particleSystem = particleSystem;
        if (this.particleSystem) this.particleSystem.surroundController = this;
    }

    _getSolidRootForId(id) {
        if (!this.particleSystem) return null;
        const solids = this.particleSystem.getSolids?.() || [];
        for (const s of solids) {
            if (s?.userData?.solution?.id === id) return s;
        }
        return null;
    }

    async loadAll(solutions) {
        // ADDED: Store solutions for potential reload
        this._pendingSolutions = solutions;
        
        // Dispose old sources properly
        for (const [id, sourceData] of this.sources) {
            try {
                if (sourceData.spatialSource) {
                    sourceData.spatialSource.dispose();
                }
            } catch (e) {
                console.warn(`Error disposing source ${id}:`, e);
            }
        }
        this.sources.clear();

        // Determine if we should use spatial audio based on mode
        const useSpatial = this.currentMode === 'main';

        console.log(`🔄 Loading audio for ${solutions.length} solutions (mode: ${this.currentMode}, spatial: ${useSpatial})`);

        for (const s of solutions) {
            if (s.audio && s.audio.data) {
                try {
                    const rawBuffer = await this._decodeBase64ToBuffer(s.audio.data);
                    const decodedBuffer = await new Promise((resolve, reject) => {
                        this.audioContext.decodeAudioData(rawBuffer.slice(0), resolve, reject);
                    });

                    const solid = this._getSolidRootForId(s.id);
                    const initialPos = solid ? solid.position : { x: 0, y: 0, z: 0 };
                    
                    // Create spatial or stereo source based on mode
                    const spatialSource = this.ctx.createSource(
                        initialPos.x, 
                        initialPos.y, 
                        initialPos.z, 
                        useSpatial
                    );
                    spatialSource.setBuffer(decodedBuffer);
                    
                    if (useSpatial) {
                        // Configure spatial audio parameters for main mode
                        spatialSource.setDistanceModel('linear');
                        spatialSource.setRefDistance(1);
                        spatialSource.setMaxDistance(this.ctx.longestSide * 2);
                        spatialSource.setRolloffFactor(10);
                    }

                    this.sources.set(s.id, {
                        spatialSource,
                        buffer: decodedBuffer,
                        targetGain: 1.0
                    });

                    console.log(`✅ Loaded source ${s.id} (${useSpatial ? 'spatial 3D' : 'stereo'})`);
                } catch (error) {
                    console.error(`❌ Failed to load source ${s.id}:`, error);
                }
            }
        }

        console.log(`[SurroundController] Loaded ${this.sources.size} sources (mode: ${this.currentMode}).`);
    }

    _playSource(sourceData) {
        if (!sourceData?.spatialSource) return;
        sourceData.spatialSource.setLoop(sourceData.shouldLoop || false);
        sourceData.spatialSource.play();
    }

    _stopSource(sourceData, fadeOut = false) {
        if (!sourceData?.spatialSource) return;
        
        if (fadeOut) {
            // IMPROVED: Use mode-specific fade duration
            const fadeDuration = this.currentMode === 'main' ? this.sequenceFadeOutMs : 400;
            sourceData.spatialSource.fadeOut(fadeDuration);
        } else {
            // Immediate stop for UI modes when explicitly requested
            sourceData.spatialSource.stop();
        }
    }

    _isSourcePlaying(sourceData) {
        return sourceData?.spatialSource?.isPlaying || false;
    }

    _setSourceVolume(sourceData, volume) {
        if (!sourceData?.spatialSource) return;
        sourceData.spatialSource.setGain(volume);
    }

    _getSourceVolume(sourceData) {
        return sourceData?.spatialSource?.getGain() || 0;
    }

    async setMode(mode) {
        const previousMode = this.currentMode;
        this.currentMode = mode;
        console.log(`🎚️ Audio mode: ${previousMode} -> ${mode}`);
        
        // FIXED: Always reload when switching to/from main mode
        const needsReload = previousMode !== mode && 
                           (previousMode === 'main' || mode === 'main');
        
        if (needsReload && this._pendingSolutions) {
            console.log(`🔄 Mode switch ${previousMode} -> ${mode} requires audio reload - reloading sources...`);
            await this.loadAll(this._pendingSolutions);
        }
    }

    async playOnly(id, opts = {}) {
        if (this._seqActive) return;
        if (!this.sources.has(id)) return;
        
        this.stopSequential();
        await this.fadeOutAll(200);
        this._highlightSource(id);
        this._updateSolidPosition(id);
        await this._playId(id, { loop: false, reset: true, autoHighlight: true });
        console.log(`[SurroundController] ▶️ Playing only source ${id}`);
    }

    async playAll(gapSeconds = 5, options = {}) {
        let userInitiated = false;
        let force = false;

        if (typeof options === 'boolean') {
            userInitiated = options;
        } else if (options && typeof options === 'object') {
            userInitiated = !!options.userInitiated;
            force = !!options.force;
        }

        if (userInitiated) {
            this._userRequestedPlay = true;
        }

        if (!this._userRequestedPlay && !force) {
            return;
        }

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        // FIXED: Resume from last index instead of starting from 0
        this.startSequential(gapSeconds, true); // Pass resume flag
        this._emitPlaybackState(true);
    }

    stopAll() {
        if (this._animationFrameId) {
            cancelAnimationFrame(this._animationFrameId);
        }

        this.stopSequential();
        for (const [id, sourceData] of this.sources.entries()) {
            try {
                this._stopSource(sourceData, false);
            } catch (e) {
                console.warn(`Error stopping source ${id}:`, e);
            }
        }
        
        if (this.sources.size > 0) {
            console.log(`[SurroundController] ⏹️ Stopped all sources.`);
        }
        
        this._dragPlayingIds.clear();
        this._activeOneShotId = null;
        this._userRequestedPlay = false;
        this._emitPlaybackState(false);

        this._startPositionUpdateLoop();
    }

    async fadeOutAll(ms = 400, pauseAfter = true) {
        const tasks = [];
        for (const [id] of this.sources) {
            tasks.push(this._fadeToZero(id, ms, pauseAfter));
        }
        await Promise.all(tasks);
        if (pauseAfter) {
            this._activeOneShotId = null;
        }
    }

    async _fadeToZero(id, fadeMs = 200, pauseAfter = true) {
        const s = this.sources.get(id);
        if (!s) return;

        const startVolume = this._getSourceVolume(s);
        const startTime = Date.now();

        return new Promise((resolve) => {
            const fade = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / fadeMs, 1);
                const volume = startVolume * (1 - progress);

                this._setSourceVolume(s, volume);

                if (progress < 1) {
                    requestAnimationFrame(fade);
                } else {
                    if (pauseAfter && this._isSourcePlaying(s)) {
                        try {
                            this._stopSource(s, false);
                        } catch {}
                    }
                    resolve();
                }
            };
            fade();
        });
    }

    async playLoopForMesh(id, meshRoot, opts = {}) {
        if (this._seqActive) return;
        if (!this.sources.has(id)) return;

        await this.stopAllManualPlayback();

        const root = meshRoot || this._getSolidRootForId(id);
        if (root) {
            this._applyGreenOutline(root);
            this._highlightById.set(id, root);
        }

        this._updateSolidPosition(id);
        await this._playId(id, { loop: true, reset: true, autoHighlight: !!root });
        this._dragPlayingIds.add(id);
        this._activeOneShotId = null;
    }

    async playOneShot(id, { highlightMesh = null, onEnded = null, allowOverlap = false } = {}) {
        if (!this.sources.has(id)) return;

        console.log(`🎵 playOneShot called for ${id}`);
        
        // FIXED: Stop all other playback INCLUDING sequential sounds
        if (!allowOverlap) {
            // Stop all manual playback (drag, previous one-shots)
            await this._stopOtherManualPlayback(id);
            
            // ADDED: Also stop any active sequential sound
            if (this._currentId != null && this._currentId !== id) {
                const currentSource = this.sources.get(this._currentId);
                if (currentSource && this._isSourcePlaying(currentSource)) {
                    console.log(`   Stopping active sequential sound: ${this._currentId}`);
                    this._stopSource(currentSource, true); // Fade out
                    this._unhighlightSource(this._currentId);
                }
            }
        }

        // Apply highlight
        let root = highlightMesh;
        if (!root) {
            this._highlightSource(id);
            root = this._highlightById.get(id);
        } else {
            // FIXED: Clear any existing highlight on this root first
            if (this._highlighted.has(root)) {
                this._clearGreenOutline(root);
            }
            this._applyGreenOutline(root);
            this._highlightById.set(id, root);
        }

        const s = this.sources.get(id);
        
        // NEW: token to ignore stale callbacks when restarting same one-shot
        const playbackToken = (s._oneShotToken = (s._oneShotToken || 0) + 1);

        const checkEnded = () => {
            if (s._oneShotToken !== playbackToken) return; // superseded by newer playback

            const now = performance.now();
            if (s._lastStartTime && (now - s._lastStartTime) < 160) {
                requestAnimationFrame(checkEnded);
                return;
            }

            if (!this._isSourcePlaying(s)) {
                console.log(`   Sound ${id} finished playing`);
                
                if (this._autoHighlightedIds.has(id) || highlightMesh) {
                    this._unhighlightSource(id);
                }
                
                if (this._activeOneShotId === id) {
                    this._activeOneShotId = null;
                }
                
                if (typeof onEnded === 'function') {
                    console.log(`🎵 Calling onEnded callback for ${id}`);
                    setTimeout(() => onEnded(), 100);
                }
            } else {
                requestAnimationFrame(checkEnded);
            }
        };
        
        this._updateSolidPosition(id);
        
        // FIXED: Resume AudioContext if suspended (for initial clicks without soundscape)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            console.log('🔊 AudioContext resumed for one-shot playback');
        }
        
        await this._playId(id, { loop: false, reset: true, autoHighlight: true });
        this._activeOneShotId = id;
        
        console.log(`   One-shot ${id} now playing`);
        requestAnimationFrame(checkEnded);
    }

    startSequential(gapSeconds = 3, resume = false) {
        if (!resume) {
            this.stopSequential();
            this._seqIdx = 0;
            this._lastSeqIdx = 0;
            console.log('🔄 Starting sequential from beginning');
        } else {
            if (this._seqTimer) {
                clearTimeout(this._seqTimer);
                this._seqTimer = null;
            }
            console.log(`🔄 Resuming sequential from index ${this._lastSeqIdx}`);
            this._seqIdx = this._lastSeqIdx;
        }

        this._seqGapMs = Math.max(0, gapSeconds * 1000);
        this._seqActive = true;

        for (const [id, s] of this.sources) {
            try {
                this._stopSource(s, false);
                this._setSourceVolume(s, 0);
                if (s.targetGain == null) s.targetGain = 1.0;
                this._unhighlightSource(id);
            } catch {}
        }

        this.clearAllGreenOutlines();
        this._playNextInSequence();
    }

    stopSequential() {
        if (this._seqActive) {
            this._lastSeqIdx = this._seqIdx % Math.max(1, this.sources.size);
        }

        this._seqActive = false;
        if (this._seqTimer) {
            clearTimeout(this._seqTimer);
            this._seqTimer = null;
        }
    }

    _playNextInSequence() {
        if (!this._seqActive || this.sources.size === 0) return;
        const ids = Array.from(this.sources.keys());
        if (!ids.length) return;

        const total = ids.length;
        const idx = this._seqIdx % total;
        const nextId = ids[idx];

        this._lastSeqIdx = (idx + 1) % total;
        this._seqIdx = this._lastSeqIdx;

        if (this._currentId && this._currentId !== nextId) {
            const prev = this.sources.get(this._currentId);
            if (prev) {
                try {
                    this._stopSource(prev, this.currentMode === 'main');
                    this._setSourceVolume(prev, 0);
                } catch {}
                for (const oldId of Array.from(this._autoHighlightedIds)) {
                    this._unhighlightSource(oldId);
                }
            }
        }

        this._currentId = nextId;

        // FIXED: Clear old highlights more aggressively
        for (const oldId of Array.from(this._autoHighlightedIds)) {
            if (oldId !== nextId) this._unhighlightSource(oldId);
        }
        
        // FIXED: Force clear all green outlines before applying new one
        this.clearAllGreenOutlines();
        
        // FIXED: Apply highlight with a small delay to ensure cleanup completed
        requestAnimationFrame(() => {
            this._highlightSource(nextId);
            this._updateSolidPosition(nextId);
        });

        const s = this.sources.get(nextId);
        if (!s) return;

        try {
            s.shouldLoop = false;
            this._setSourceVolume(s, 0);
            this._playSource(s);
            
            this._fadeVolume(s, s.targetGain ?? 1.0, this.sequenceFadeInMs);
            
            const checkEnd = () => {
                if (!this._isSourcePlaying(s)) {
                    this._unhighlightSource(nextId);
                    this._seqTimer = setTimeout(() => this._playNextInSequence(), this._seqGapMs);
                } else if (this._seqActive) {
                    requestAnimationFrame(checkEnd);
                }
            };
            requestAnimationFrame(checkEnd);
            
        } catch (error) {
            console.error('Failed to play in sequence:', error);
            this._unhighlightSource(nextId);
            this._seqTimer = setTimeout(() => this._playNextInSequence(), this._seqGapMs);
        }
    }

    async _fadeVolume(sourceData, targetVolume, ms = 200) {
        if (!sourceData) return;
        
        const startVolume = this._getSourceVolume(sourceData);
        const startTime = Date.now();
        
        return new Promise((resolve) => {
            const fade = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / ms, 1);
                const volume = startVolume + (targetVolume - startVolume) * progress;
                
                this._setSourceVolume(sourceData, volume);
                
                if (progress < 1) {
                    requestAnimationFrame(fade);
                } else {
                    resolve();
                }
            };
            fade();
        });
    }

    async _playId(id, { loop = false, reset = true, autoHighlight = false } = {}) {
        const s = this.sources.get(id);
        if (!s) return;

        try {
            if (reset && this._isSourcePlaying(s)) {
                this._stopSource(s, false);
            }

            s.shouldLoop = !!loop;
            this._setSourceVolume(s, 0);
            s._lastStartTime = performance.now();
            this._playSource(s);

            await this._fadeVolume(s, s.targetGain ?? 1.0, 250);

            if (autoHighlight && !loop) {
                const checkEnd = () => {
                    if (!this._isSourcePlaying(s)) {
                        this._unhighlightSource(id);
                    } else {
                        requestAnimationFrame(checkEnd);
                    }
                };
                requestAnimationFrame(checkEnd);
            }
        } catch (e) {
            console.error(`Failed to play ${id}:`, e);
        }
    }

    _updateSolidPosition(id) {
        const solid = this._getSolidRootForId(id);
        const s = this.sources.get(id);

        if (solid && s?.spatialSource && s.spatialSource.isSpatial) {
            s.spatialSource.setPosition(
                solid.position.x,
                solid.position.y,
                solid.position.z
            );
        }
    }

    _highlightSource(id) {
        // FIXED: Force clear if already highlighted
        if (this._highlightById.has(id)) {
            this._unhighlightSource(id);
        }
        
        const root = this._getSolidRootForId(id);
        if (!root) {
            console.warn(`⚠️ No solid found for id ${id}`);
            return;
        }
        
        console.log(`✨ Highlighting source ${id}`);
        this._applyGreenOutline(root);
        this._highlightById.set(id, root);
        this._autoHighlightedIds.add(id);
    }

    _unhighlightSource(id) {
        if (!this._highlightById.has(id)) return;
        
        console.log(`🔲 Unhighlighting source ${id}`);
        const root = this._highlightById.get(id);
        this._clearGreenOutline(root);
        this._highlightById.delete(id);
        this._autoHighlightedIds.delete(id);
    }

    _applyGreenOutline(root) {
        // FIXED: Force clear existing highlight first
        if (this._highlighted.has(root)) {
            this._clearGreenOutline(root);
        }
        
        if (!root) return;
        
        const highlightColor = new THREE.Color(0x53d3c0);
        const originals = [];
        
        root.traverse(child => {
            if (!child.isMesh) return;
            
            const baseMat = child.material;
            if (!baseMat) return;
            
            // FIXED: Always store fresh original reference
            if (!child.userData.__surroundOriginalMaterial) {
                child.userData.__surroundOriginalMaterial = baseMat;
            }
            
            originals.push({ mesh: child, material: baseMat });
            
            // Create tinted material safely
            let tinted;
            if (typeof baseMat.clone === 'function') {
                try {
                    tinted = baseMat.clone();
                } catch (e) {
                    console.warn('Failed to clone material:', e);
                    tinted = baseMat;
                }
            } else {
                tinted = new THREE.MeshStandardMaterial({
                    color: highlightColor,
                    emissive: highlightColor,
                    emissiveIntensity: 0.5
                });
            }

            // Apply green tint
            if (tinted !== baseMat) {
                if ('emissive' in tinted && tinted.emissive && typeof tinted.emissive.copy === 'function') {
                    try {
                        tinted.emissive.copy(highlightColor);
                        tinted.emissiveIntensity = Math.max(0.5, tinted.emissiveIntensity ?? 0);
                    } catch (e) {
                        console.warn('Failed to set emissive:', e);
                    }
                }
                if ('color' in tinted && tinted.color && typeof tinted.color.lerp === 'function') {
                    try {
                        const newColor = tinted.color.clone();
                        newColor.lerp(highlightColor, 0.45);
                        tinted.color = newColor;
                    } catch (e) {
                        console.warn('Failed to lerp color:', e);
                    }
                }
                tinted.transparent = true;
                tinted.opacity = Math.min(0.95, baseMat.opacity ?? 1);
                tinted.needsUpdate = true;
                
                child.material = tinted;
            }
        });
        
        this._highlighted.set(root, { originals });
        this._highlightRoots.add(root);
        
        console.log(`✅ Applied green outline to root with ${originals.length} meshes`);
    }

    _clearGreenOutline(root) {
        if (!root) return;
        
        const rec = this._highlighted.get(root);
        if (!rec) {
            this._highlightRoots.delete(root);
            return;
        }
        
        rec.originals.forEach(({ mesh, material }) => {
            if (!mesh) return;
            const original = mesh.userData.__surroundOriginalMaterial || material;
            if (original) {
                mesh.material = original;
            }
            delete mesh.userData.__surroundOriginalMaterial;
        });
        
        this._highlighted.delete(root);
        this._highlightRoots.delete(root);
        
        console.log(`✅ Cleared green outline from root`);
    }

    clearAllGreenOutlines() {
        console.log(`🧹 Clearing all green outlines (${this._highlightRoots.size} roots)`);
        
        const roots = Array.from(this._highlightRoots);
        for (const root of roots) {
            this._clearGreenOutline(root);
        }
        
        // Extra cleanup pass
        for (const root of Array.from(this._highlighted.keys())) {
            this._clearGreenOutline(root);
        }
        
        this._autoHighlightedIds.clear();
        this._highlightById.clear();
        
        console.log(`✅ All outlines cleared`);
    }

    async stopAllManualPlayback() {
        console.log('🛑 Stopping ALL manual playback');
        
        for (const id of Array.from(this._dragPlayingIds)) {
            const s = this.sources.get(id);
            if (s && this._isSourcePlaying(s)) {
                try {
                    this._stopSource(s, this.currentMode === 'main');
                } catch {}
            }
        }
        this._dragPlayingIds.clear();
        
        if (this._activeOneShotId != null) {
            const s = this.sources.get(this._activeOneShotId);
            if (s && this._isSourcePlaying(s)) {
                try {
                    this._stopSource(s, this.currentMode === 'main');
                } catch {}
            }
            this._activeOneShotId = null;
        }
        
        this.stopSequential();
        this.clearAllGreenOutlines();
        
        console.log('✅ All audio stopped');
    }

    async _stopOtherManualPlayback(exceptId = null) {
        for (const otherId of Array.from(this._dragPlayingIds)) {
            if (otherId === exceptId) continue;
            const s = this.sources.get(otherId);
            if (s) {
                s._oneShotToken = (s._oneShotToken || 0) + 1;
            }
            
            try {
                this._stopSource(s, this.currentMode === 'main');
            } catch {}
            
            this._dragPlayingIds.delete(otherId);
            this._unhighlightSource(otherId);
        }
        
        if (this._activeOneShotId != null && this._activeOneShotId !== exceptId) {
            const activeSource = this.sources.get(this._activeOneShotId);
            if (activeSource) {
                activeSource._oneShotToken = (activeSource._oneShotToken || 0) + 1;
            }
            
            this._unhighlightSource(this._activeOneShotId);
            this._activeOneShotId = null;
        }
    }

    async _decodeBase64ToBuffer(base64) {
        const bin = atob(base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr.buffer;
    }

    _emitPlaybackState(playing) {
        try {
            window.dispatchEvent(new CustomEvent('surround-playback-state', {
                detail: { playing: !!playing }
            }));
        } catch {}
    }

    hasUserRequestedSoundscape() {
        return this._userRequestedPlay;
    }

    async startMode(fadeMs = 500) {
        this.stopSequential();
        await this.fadeOutAll(fadeMs, true);
    }

    resumeMainMode(gapSeconds = 5) {
        if (!this._userRequestedPlay) return;
        return this.playAll(gapSeconds);
    }

    async stopUserSoundscape(fadeMs = 400) {
        const wasActive = this._seqActive || this._userRequestedPlay;
        
        // ADDED: Store current state before stopping
        const currentIdx = this._seqIdx;
        
        this._userRequestedPlay = false;
        this.stopSequential();
        await this.fadeOutAll(fadeMs, true);
        this._activeOneShotId = null;
        
        // FIXED: Don't clear outlines immediately - let them fade
        setTimeout(() => {
            this.clearAllGreenOutlines();
        }, fadeMs);
        
        if (wasActive) {
            this._emitPlaybackState(false);
        }
    }

    // Make sure this method exists and works properly
    async stopOneShotById(id, fadeMs = 300) {
        if (!this.sources.has(id)) {
            console.warn(`⚠️ Cannot stop one-shot ${id} - source not found`);
            return;
        }
        
        console.log(`🛑 Stopping one-shot ${id} with ${fadeMs}ms fade`);
        
        const s = this.sources.get(id);
        if (s) {
            s._oneShotToken = (s._oneShotToken || 0) + 1; // invalidate pending checks
        }
        
        // CRITICAL: Stop the source and WAIT for fade to complete
        if (this._isSourcePlaying(s)) {
            await this._fadeToZero(id, fadeMs, true);
        }
        
        // Clear highlight AFTER fade completes
        this._unhighlightSource(id);
        
        // Remove from tracking
        this._activeOneShotIds.delete(id);
        if (this._activeOneShotId === id) {
            this._activeOneShotId = null;
        }
        
        console.log(`✅ One-shot ${id} stopped and faded out`);
    }
}