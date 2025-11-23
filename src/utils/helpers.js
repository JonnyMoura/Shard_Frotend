export function loadTexture(url) {
    const textureLoader = new THREE.TextureLoader();
    return new Promise((resolve, reject) => {
        textureLoader.load(url, resolve, undefined, reject);
    });
}

export function createAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    return new AudioContext();
}

export function setupAudioElement(sourceUrl) {
    const audio = new Audio(sourceUrl);
    audio.crossOrigin = "anonymous";
    return audio;
}

export function mapToRange(value, inMin, inMax, outMin, outMax) {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}