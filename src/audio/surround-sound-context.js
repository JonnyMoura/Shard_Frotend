export class SurroundContext {
  constructor(w, roomWidth, roomHeight, roomDepth) {
    this.actx = new (w.AudioContext || w.webkitAudioContext)();
    
    // Store room dimensions (Three.js: X=width, Y=height, Z=depth)
    this.roomWidth = roomWidth;
    this.roomHeight = roomHeight;
    this.roomDepth = roomDepth;
    this.longestSide = Math.max(roomWidth, roomHeight, roomDepth);
    
    // Create listener (represents the user's ears)
    this.listener = this.actx.listener;
    
    // Set listener position at center (0, 0, 0) in Three.js coordinates
    if (this.listener.positionX) {
      this.listener.positionX.setValueAtTime(0, this.actx.currentTime);
      this.listener.positionY.setValueAtTime(0, this.actx.currentTime);
      this.listener.positionZ.setValueAtTime(0, this.actx.currentTime);
    } else {
      this.listener.setPosition(0, 0, 0);
    }
    
    // Set listener orientation (facing negative Z in Three.js)
    // Forward vector: (0, 0, -1) - looking into the screen
    // Up vector: (0, 1, 0) - Y is up
    if (this.listener.forwardX) {
      this.listener.forwardX.setValueAtTime(0, this.actx.currentTime);
      this.listener.forwardY.setValueAtTime(0, this.actx.currentTime);
      this.listener.forwardZ.setValueAtTime(-1, this.actx.currentTime);
      this.listener.upX.setValueAtTime(0, this.actx.currentTime);
      this.listener.upY.setValueAtTime(1, this.actx.currentTime);
      this.listener.upZ.setValueAtTime(0, this.actx.currentTime);
    } else {
      this.listener.setOrientation(0, 0, -1, 0, 1, 0);
    }
    
    console.log(`🎧 Web Audio 3D Spatialization initialized`);
    console.log(`   Room: ${roomWidth} x ${roomHeight} x ${roomDepth}`);
    console.log(`   Listener at origin, facing -Z (Three.js coordinate system)`);
  }
  
  createSource(x = 0, y = 0, z = 0, spatial = true) {
    return new SpatialSource(this.actx, x, y, z, this.longestSide, spatial);
  }
  
  setListenerPosition(x, y, z) {
    if (this.listener.positionX) {
      this.listener.positionX.setValueAtTime(x, this.actx.currentTime);
      this.listener.positionY.setValueAtTime(y, this.actx.currentTime);
      this.listener.positionZ.setValueAtTime(z, this.actx.currentTime);
    } else {
      this.listener.setPosition(x, y, z);
    }
  }
  
  setListenerOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ) {
    if (this.listener.forwardX) {
      this.listener.forwardX.setValueAtTime(forwardX, this.actx.currentTime);
      this.listener.forwardY.setValueAtTime(forwardY, this.actx.currentTime);
      this.listener.forwardZ.setValueAtTime(forwardZ, this.actx.currentTime);
      this.listener.upX.setValueAtTime(upX, this.actx.currentTime);
      this.listener.upY.setValueAtTime(upY, this.actx.currentTime);
      this.listener.upZ.setValueAtTime(upZ, this.actx.currentTime);
    } else {
      this.listener.setOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ);
    }
  }
  
  get audioContext() {
    return this.actx;
  }
}

class SpatialSource {
  constructor(audioContext, x, y, z, longestSide, spatial = true) {
    this.ctx = audioContext;
    this.longestSide = longestSide;
    this.isSpatial = spatial;
    
    // Create audio nodes
    this.gainNode = this.ctx.createGain();
    
    if (spatial) {
      // Create panner for 3D spatialization
      this.pannerNode = this.ctx.createPanner();
      
      // Configure panner for 3D spatialization - natural settings
      this.pannerNode.panningModel = 'HRTF';
      this.pannerNode.distanceModel = 'linear';
      this.pannerNode.refDistance = 1;
      this.pannerNode.maxDistance = longestSide * 2;
      this.pannerNode.rolloffFactor = 3;
      this.pannerNode.coneInnerAngle = 360;
      this.pannerNode.coneOuterAngle = 360;
      this.pannerNode.coneOuterGain = 0;
      
      // Connect: gain -> panner -> destination
      this.gainNode.connect(this.pannerNode);
      this.pannerNode.connect(this.ctx.destination);
    } else {
      // Non-spatial: just connect gain directly to destination (stereo)
      this.gainNode.connect(this.ctx.destination);
      this.pannerNode = null;
    }
    
    // Natural gain (no boost)
    this.gainNode.gain.setValueAtTime(1.0, this.ctx.currentTime);
    
    // Position (Three.js coordinates) - only used for spatial sources
    this.x = x;
    this.y = y;
    this.z = z;
    if (spatial) {
      this.setPosition(x, y, z);
    }
    
    // Playback state
    this.disposed = false;
    this.audioBuffer = null;
    this.bufferSource = null;
    this.isPlaying = false;
    this.looping = false;
    this.isFadingOut = false;
    this.fadeOutTimer = null;
    
    const mode = spatial ? 'spatial 3D' : 'stereo';
    console.log(`🔊 SpatialSource created in ${mode} mode`);
  }
  
  get input() {
    return this.gainNode;
  }
  
  setPosition(x, y, z) {
    if (!this.isSpatial || !this.pannerNode) return;
    
    this.x = x;
    this.y = y;
    this.z = z;
    
    // Update panner position using Three.js coordinates
    if (this.pannerNode.positionX) {
      // Modern API
      this.pannerNode.positionX.setValueAtTime(x, this.ctx.currentTime);
      this.pannerNode.positionY.setValueAtTime(y, this.ctx.currentTime);
      this.pannerNode.positionZ.setValueAtTime(z, this.ctx.currentTime);
    } else {
      // Legacy API
      this.pannerNode.setPosition(x, y, z);
    }
  }
  
  setOrientation(x, y, z) {
    if (!this.isSpatial || !this.pannerNode) return;
    
    // Set the direction the source is pointing (for directional sources)
    if (this.pannerNode.orientationX) {
      this.pannerNode.orientationX.setValueAtTime(x, this.ctx.currentTime);
      this.pannerNode.orientationY.setValueAtTime(y, this.ctx.currentTime);
      this.pannerNode.orientationZ.setValueAtTime(z, this.ctx.currentTime);
    } else {
      this.pannerNode.setOrientation(x, y, z);
    }
  }
  
  setBuffer(buffer) {
    if (this.disposed) return;
    this.audioBuffer = buffer;
  }
  
  setLoop(loop) {
    this.looping = loop;
    if (this.bufferSource) {
      this.bufferSource.loop = loop;
    }
  }
  
  setGain(value) {
    if (this.disposed) return;
    // No boost - natural gain
    this.gainNode.gain.setValueAtTime(value, this.ctx.currentTime);
  }
  
  getGain() {
    return this.disposed ? 0 : this.gainNode.gain.value;
  }
  
  // Distance model configuration
  setDistanceModel(model) {
    if (!this.isSpatial || !this.pannerNode) return;
    this.pannerNode.distanceModel = model;
  }
  
  setRefDistance(distance) {
    if (!this.isSpatial || !this.pannerNode) return;
    this.pannerNode.refDistance = distance;
    console.log(`🔊 RefDistance set to: ${distance}`);
  }
  
  setMaxDistance(distance) {
    if (!this.isSpatial || !this.pannerNode) return;
    this.pannerNode.maxDistance = distance;
    console.log(`🔊 MaxDistance set to: ${distance}`);
  }
  
  setRolloffFactor(factor) {
    if (!this.isSpatial || !this.pannerNode) return;
    this.pannerNode.rolloffFactor = factor;
    console.log(`🔊 Rolloff factor set to: ${factor}`);
  }
  
  // Cone configuration for directional sources
  setConeAngles(innerAngle, outerAngle) {
    if (!this.isSpatial || !this.pannerNode) return;
    this.pannerNode.coneInnerAngle = innerAngle;
    this.pannerNode.coneOuterAngle = outerAngle;
  }
  
  setConeOuterGain(gain) {
    if (!this.isSpatial || !this.pannerNode) return;
    this.pannerNode.coneOuterGain = gain;
  }
  
  play() {
    if (this.disposed || !this.audioBuffer || this.isPlaying) return;
    
    // Cancel any ongoing fade out
    this.isFadingOut = false;
    if (this.fadeOutTimer) {
      clearTimeout(this.fadeOutTimer);
      this.fadeOutTimer = null;
    }
    
    // Create new buffer source
    this.bufferSource = this.ctx.createBufferSource();
    this.bufferSource.buffer = this.audioBuffer;
    this.bufferSource.loop = this.looping;
    
    // Connect to gain node
    this.bufferSource.connect(this.gainNode);
    
    // Handle end
    this.bufferSource.onended = () => {
      if (!this.looping && !this.isFadingOut) {
        this.isPlaying = false;
      }
    };
    
    // Start playback
    this.bufferSource.start(0);
    this.isPlaying = true;
    
    if (this.isSpatial) {
      const distance = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
      console.log(`▶️ Playing 3D audio at position (${this.x.toFixed(1)}, ${this.y.toFixed(1)}, ${this.z.toFixed(1)}) | Distance: ${distance.toFixed(1)} | Gain: ${this.gainNode.gain.value.toFixed(2)}`);
    } else {
      console.log(`▶️ Playing stereo audio | Gain: ${this.gainNode.gain.value.toFixed(2)}`);
    }
  }
  
  fadeOut(duration = 500) {
    if (!this.bufferSource || !this.isPlaying || this.isFadingOut) return;
    
    this.isFadingOut = true;
    const startGain = this.gainNode.gain.value;
    const startTime = this.ctx.currentTime;
    
    // Linear fade out using Web Audio API
    this.gainNode.gain.setValueAtTime(startGain, startTime);
    this.gainNode.gain.linearRampToValueAtTime(0, startTime + duration / 1000);
    
    // Stop the source after fade completes
    this.fadeOutTimer = setTimeout(() => {
      this.stop();
      this.isFadingOut = false;
      this.fadeOutTimer = null;
    }, duration);
    
    console.log(`🔉 Fading out audio over ${duration}ms`);
  }
  
  stop() {
    if (!this.bufferSource || !this.isPlaying) return;
    
    // Cancel fade out if in progress
    if (this.fadeOutTimer) {
      clearTimeout(this.fadeOutTimer);
      this.fadeOutTimer = null;
    }
    
    try {
      this.bufferSource.stop();
      this.bufferSource.disconnect();
    } catch (e) {
      console.warn('Error stopping buffer source:', e);
    }
    
    this.bufferSource = null;
    this.isPlaying = false;
    this.isFadingOut = false;
  }
  
  dispose() {
    if (this.disposed) return;
    
    this.stop();
    this.gainNode.disconnect();
    if (this.pannerNode) {
      this.pannerNode.disconnect();
    }
    this.disposed = true;
    this.audioBuffer = null;
    
    console.log(`🗑️ Disposed audio source`);
  }
}