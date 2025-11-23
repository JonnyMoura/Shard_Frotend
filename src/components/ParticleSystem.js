import * as THREE from 'three';
import { createGeometricSolid } from './GeometricSolid';
import { SpatialGrid } from './SpatialGrid.js'; // CHANGED: Named import with curly braces


const complementary_map = {
    'low': 'mid',
    'high': 'mid', 
    'mid': 'rhythmic',
    'rhythmic': 'mid'
};

function generateSwarmPeakPositions(numPeaks, time, baseRadius = 50, spread = 75) {
    const positions = [];
    for (let i = 0; i < numPeaks; i++) {
        const t = time + i * 10;
        const angle = Math.sin(t * 0.13 + i) * Math.PI + Math.cos(t * 0.17 + i * 0.5) * Math.PI * 0.5;
        const radius = baseRadius + Math.sin(t * 0.07 + i) * spread * 0.5 + Math.cos(t * 0.11 + i) * spread * 0.3;
        positions.push(new THREE.Vector3(
            Math.cos(angle) * radius,
            0,
            Math.sin(angle) * radius
        ));
    }
    return positions;
}



export class ParticleSystem {
    constructor(scene, baseRadius = 2) {
        this.scene = scene;
        this.baseRadius = baseRadius;
        this.peaks = [];
        this.previousHeights = [];
        this.time = 0;
        this.updateInterval = 40;
        this.frameCounter = 0;
        this.targetLocked = false;
        this.frozenSwarmPositions = null;
        this.lightPositions = [];
        this.lightIntensities = [];
        this.currentSolutions = [];
        this.isEvolvingFrozen = false;
        this.evolvingActive = false;
        this.grainsPerVisiblePeak = 300;
        this.categoryFilterActive = false;

        this.defaultGrainClearance = 1.0;
        this.grainColumnHeight = 6.0;

      
        this.evolveSessionBaseY = null;

        this.spatialGrid = new SpatialGrid(50);

        this.initPeaks();

        this.peakSolids = [];
        
             this.motionSystem = {
            mode: 'lerp',
            followLerp: 0.05,
            
            maxVelocity: 1.5,  // NEW: units per frame (tune this!)
            
            // === GLOBAL BEHAVIOR ===
            swarmWeight: 0.20,           // REDUCED: let pairs dominate over swirl (was 0.35)
            maxOffset: 5.0,

            // === REPULSION (personal space) ===
            minSeparation: 30,
            repulsionStrength: 0.20,
            repulsionWeight: 0.4,

            // === COMPLEMENTARY ATTRACTION (pre-pairing) ===
            complementaryRange: 35,
            complementaryPull: 0.008,
            attractionWeight: 0.2,

            // === PAIRING (formation & maintenance) ===
            pairFormRadius: 25,
            pairKeepRadius: 35,
            pairMinFrames: 480,
            pairBreakProb: 0.0003,
            pairCooldown: 240,

            // === BOIDS FLOCKING (separation, cohesion, alignment) ===
            // SEPARATION: maintain distance but stay together
            pairDesiredSeparation: 25,      // INCREASED: wider gap (was 15)
            pairSeparationStrength: 0.32,   // INCREASED: stronger spacing (was 0.26)
            
            // COHESION: pull toward shared center
            pairCohesionStrength: 0.5,      // INCREASED: stronger pull to center (was 0.5)
            
            // ALIGNMENT: match headings
            pairAlignmentStrength: 3.2,     // INCREASED: much stronger (was 2.5)
            pairTravelSpeed: 2.0,           // INCREASED: faster (was 1.6)
            pairHeadingSmoothing: 0.04,     // REDUCED: quicker sync (was 0.05)
            pairHeadingJitter: 1,           // REDUCED: minimal jitter (was 2)
            pairJitterInterval: 280,        // INCREASED: jitter very rarely (was 220)

            // === PAIR EASE-IN ===
            pairEaseFrames: 150,            // REDUCED: faster stabilization (was 180)

            // === PAIR BREAK SMOOTHING ===
            breakGraceFrames: 300,

            // === EXPLORATION (solo movement) ===
            wanderStrength: 0.45,
            wanderInPair: 0.015,            // REDUCED: almost no wander when paired (was 0.02)
            circularBias: 0.18,
            explorationPairedScale: 0.10,   // REDUCED: minimal exploration in pairs (was 0.10)
            maxRange: 180,

            // === CENTER AVOIDANCE ===
            avoidCenterRadius: 50,
            avoidCenterStrength: 0.8,

            // === WEIGHT SYSTEM ===
            pairingWeight: 1.6,             // INCREASED: pairs dominate (was 1.2)
            explorationWeight: 0.4,

            // NEW: Additional tuning parameters
            forceDamping: 0.85,              // Exponential decay on force offset
            velocityBlendRate: 0.3,          // How quickly velocity adapts to desired
            swirlPairedScale: 0.55,          // Reduce swirl influence when paired
            
            // Grain behavior
            grainSpringStrength: 0.12,
            grainOrbitSpeed: 0.4,
            grainOrbitAmount: 0.15,
            grainVelocityDamping: 0.88,
            grainMaxSpeedMultiplier: 1.8,
            
            // Evolving
            evolvingLerpSpeed: 0.12,
            
            // Repulsion
            pairedRepulsionScale: 0.4,       // Reduce repulsion between paired members
            attractionInnerMargin: 1.2,      // Safety margin multiplier
            
            // Heading
            headingTangentWeight: 0.85,     // INCREASED: prioritize desired direction (was 0.6)
            headingVelocityWeight: 0.15,
            
            // Boundary
            boundaryPushRate: 0.05
        };
    // Simplified state tracking
    this._pairStates = [];          // {partner: -1|index, frames: 0, cooldown: 0}
    this._lastPositions = [];       // for deriving velocities when needed
    this._pairDirections = [];      // Shared directions for pairs
    this._velocities = [];          // NEW: track actual velocities

    this.initPairConnections();
}
    

    initPeaks() {
        const numPeaks = 10;
        const peakSpacing = 30;
        for (let i = 0; i < numPeaks; i++) {
            const peak = {
                grains: [],
                grainTargets: [],
                movingToNewPyramid: false,
                nextPyramidCenter: new THREE.Vector3(i * peakSpacing - (numPeaks * peakSpacing) / 2, 0, 0),
                currentPyramidCenter: new THREE.Vector3(i * peakSpacing - (numPeaks * peakSpacing) / 2, 0, 0),
                readyForNextMove: true,
                categoryVisible: true,
                exploreSeed: Math.random() * 1000 // NEW seed for exploration
            };

            const grainCount = 300;
            for (let j = 0; j < grainCount; j++) {
                const grain = new THREE.Mesh(
                    new THREE.SphereGeometry(0.09, 8, 8),
                    new THREE.MeshStandardMaterial({ 
                        color: 0xe0dbc1,
                        emissive: 0xe0dbc1,        
                        emissiveIntensity: 0.3,
                        transparent: true,
                        opacity: 0.8
                    })
                );

                grain.layers.enable(1);

                const heightFactor = Math.random();
                const minRadius = 0.2 * this.baseRadius;
                const scaledRadius = minRadius + (1 - heightFactor) * (this.baseRadius - minRadius);
                const angle = Math.random() * Math.PI * 2;
                const randomization = [];
                for (let r = 0; r < 4; r++) randomization.push(0.3 + 0.4 * Math.random());

                const baseAccel = 0.10 + 0.25 * Math.random();
                const baseSpeed = 0.025 + 0.050 * Math.random();
                const maxSpeed = 0.15 + 0.18 * Math.random();

                grain.userData = {
                    heightFactor,
                    angle,
                    randomization,
                    transitionSeed: Math.random() * 100,
                    baseAccel,
                    baseSpeed,
                    maxSpeed
                };

                grain.position.set(
                    peak.currentPyramidCenter.x + scaledRadius * Math.cos(angle),
                    heightFactor * 8 + Math.random() * 0.6 - 0.3,
                    peak.currentPyramidCenter.z + scaledRadius * Math.sin(angle)
                );

                const theta = Math.random() * 2 * Math.PI;
                const phi = Math.random() * Math.PI;
                grain.userData.velocity = new THREE.Vector3(
                    Math.sin(phi) * Math.cos(theta),
                    Math.cos(phi),
                    Math.sin(phi) * Math.sin(theta)
                ).multiplyScalar(baseSpeed);

                grain.userData.acceleration = new THREE.Vector3();

                this.scene.add(grain);
                peak.grains.push(grain);
                peak.grainTargets.push(grain.position.clone());
            }

            this.peaks.push(peak);
            this.previousHeights.push(8);
        }
    }

    initPairConnections() {
        this.pairLines = [];
        const lineMaterial = new THREE.LineBasicMaterial({ 
            color: 0x88ff88, 
            transparent: true,
            opacity: 0.6 
        });
        
        for (let i = 0; i < 15; i++) {
            const lineGeometry = new THREE.BufferGeometry();
            const line = new THREE.Line(lineGeometry, lineMaterial);
            line.visible = false;
            this.scene.add(line);
            this.pairLines.push(line);
        }
    }

    regenerateWithSolutions(solutions) {
        // Guard clause
        if (!this.peaks || this.peaks.length === 0) {
            console.warn('⚠️ Cannot regenerate - peaks not initialized. Call initializeWithData() first.');
            return;
        }

        if (!solutions || solutions.length === 0) {
            console.warn('⚠️ No solutions provided for regeneration');
            return;
        }
        
        this.currentSolutions = solutions;
        
        this.peakSolids.forEach(solid => {
            if (solid && this.scene) {
                this.scene.remove(solid);
            }
        });
        this.peakSolids = [];

        const targetPeaks = solutions.length;
        const currentPeaks = this.peaks.length;
        
        if (targetPeaks !== currentPeaks) {
            
            this.adjustPeakCount(targetPeaks);
        }

        this.ensureArraySizes();

        for (let i = 0; i < Math.min(solutions.length, this.peaks.length); i++) {
            const solution = solutions[i];
            const peak = this.peaks[i];
            
            if (!peak || !peak.currentPyramidCenter) {
                console.warn(`⚠️ Invalid peak at index ${i}, skipping solid creation`);
                continue;
            }
            
            try {
                console.log(`🎨 Creating solid ${i} for solution ${solution.id}:`, solution.parameters);
                
                const solid = createGeometricSolid(solution);
                if (solid) {
                    solid.position.copy(peak.currentPyramidCenter);
                    solid.position.y += 6;
                    this.scene.add(solid);
                    this.peakSolids.push(solid);
                }
            } catch (error) {
                console.error(`❌ Error creating solid ${i}:`, error);
            }
        }
        
        console.log('✅ Regeneration complete:', this.peakSolids.length, 'solids created');
    }

    adjustPeakCount(targetCount) {
        if (targetCount <= 0) {
            console.warn('⚠️ Invalid target count for peaks:', targetCount);
            return;
        }
        
        const currentCount = this.peaks.length;
        
        if (targetCount > currentCount) {
            
            for (let i = currentCount; i < targetCount; i++) {
                this.createSinglePeak(i, targetCount);
            }
        } else if (targetCount < currentCount) {
           
            for (let i = currentCount - 1; i >= targetCount; i--) {
                this.removeSinglePeak(i);
            }
        }

        this.repositionPeaks();
    }

    createSinglePeak(index, totalPeaks) {
        const peakSpacing = 80;
        const peak = {
            grains: [],
            grainTargets: [],
            movingToNewPyramid: false,
            nextPyramidCenter: new THREE.Vector3(index * peakSpacing - (totalPeaks * peakSpacing) / 2, 0, 0),
            currentPyramidCenter: new THREE.Vector3(index * peakSpacing - (totalPeaks * peakSpacing) / 2, 0, 0),
            readyForNextMove: true,
            velocity: new THREE.Vector3(),
            acceleration: new THREE.Vector3(),
            categoryVisible: true, // <- default visible
        };

        const grainCount = 300;
        for (let j = 0; j < grainCount; j++) {
            try {
                const grain = this.createSingleGrain(peak);
                if (grain) {
                    this.scene.add(grain);
                    peak.grains.push(grain);
                    peak.grainTargets.push(grain.position.clone());
                }
            } catch (error) {
                console.error(`Error creating grain ${j} for peak ${index}:`, error);
            }
        }

        this.peaks.push(peak);
        this.previousHeights.push(8);
    }

    removeSinglePeak(index) {
        if (index < 0 || index >= this.peaks.length) return;
        
        const peak = this.peaks[index];
        if (peak && peak.grains) {
            peak.grains.forEach(grain => {
                if (grain && this.scene) {
                    this.scene.remove(grain);
                }
            });
        }
        
        this.peaks.splice(index, 1);
        if (this.previousHeights.length > index) {
            this.previousHeights.splice(index, 1);
        }
    }

    createSingleGrain(peak) {
        const grain = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 8, 8),
            new THREE.MeshStandardMaterial({ 
                color: 0xe0dbc1,
                emissive: 0xe0dbc1,        
                emissiveIntensity: 0.3,
                transparent: true,
                opacity: 0.8
            })
        );

        grain.layers.enable(1);

        const heightFactor = Math.random();
        const minRadius = 0.2 * this.baseRadius;
        const scaledRadius = minRadius + (1 - heightFactor) * (this.baseRadius - minRadius);
        const angle = Math.random() * Math.PI * 2;
        const randomization = [];
        for (let r = 0; r < 4; r++) randomization.push(0.3 + 0.4 * Math.random());

        const baseAccel = 0.08 + 0.10 * Math.random();
        const baseSpeed = 0.025 + 0.050 * Math.random();
        const maxSpeed = 0.05 + 0.18 * Math.random();

        grain.userData = {
            heightFactor,
            angle,
            randomization,
            transitionSeed: Math.random() * 100,
            baseAccel,
            baseSpeed,
            maxSpeed,
            velocity: new THREE.Vector3(),
            acceleration: new THREE.Vector3()
        };

        grain.position.set(
            peak.currentPyramidCenter.x + scaledRadius * Math.cos(angle),
            heightFactor * 8 + Math.random() * 0.6 - 0.3,
            peak.currentPyramidCenter.z + scaledRadius * Math.sin(angle)
        );

        const theta = Math.random() * 2 * Math.PI;
        const phi = Math.random() * Math.PI;
        grain.userData.velocity = new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta),
            Math.cos(phi),
            Math.sin(phi) * Math.sin(theta)
        ).multiplyScalar(baseSpeed);

        return grain;
    }

    repositionPeaks() {
        const peakSpacing = 30;
        for (let i = 0; i < this.peaks.length; i++) {
            const newX = i * peakSpacing - (this.peaks.length * peakSpacing) / 2;
            if (this.peaks[i]) {
                this.peaks[i].currentPyramidCenter.x = newX;
                this.peaks[i].nextPyramidCenter.x = newX;
            }
        }
    }

    ensureArraySizes() {
        const peakCount = this.peaks.length;
        
        while (this.previousHeights.length < peakCount) {
            this.previousHeights.push(8);
        }
        while (this.previousHeights.length > peakCount) {
            this.previousHeights.pop();
        }
        
        while (this.peakSolids.length > peakCount) {
            const solid = this.peakSolids.pop();
            if (solid && this.scene) {
                this.scene.remove(solid);
            }
        }
        
        if (this.frozenSwarmPositions && this.frozenSwarmPositions.length !== peakCount) {
            if (this.targetLocked) {
                this.frozenSwarmPositions = generateSwarmPeakPositions(peakCount, this.time);
            }
        }
    }

    smoothTransition(current, target, speed) {
        return current + (target - current) * speed;
    }

    setNewGrainTargets(peak, smoothedHeight) {
        for (let j = 0; j < peak.grains.length; j++) {
            const { heightFactor, angle } = peak.grains[j].userData;
            const minRadius = 0.2 * this.baseRadius;
            const scaledRadius = minRadius + (1 - heightFactor) * (this.baseRadius - minRadius);
            peak.grainTargets[j] = new THREE.Vector3(
                peak.nextPyramidCenter.x + scaledRadius * Math.cos(angle),
                heightFactor * smoothedHeight,
                peak.nextPyramidCenter.z + scaledRadius * Math.sin(angle)
            );
        }
        peak.movingToNewPyramid = true;
    }

    startEvolvingAlignment(targetList) {
        if (!Array.isArray(targetList) || targetList.length === 0) return;
        this.evolvingActive = true;

        // Map solids to peak indices
        targetList.forEach(entry => {
            const solid = entry.solid;
            const target = entry.target;
            const peakIndex = this.peakSolids.indexOf(solid);
            if (peakIndex !== -1 && this.peaks[peakIndex]) {
                const peak = this.peaks[peakIndex];
                peak.evolvingTargetCenter = target.clone(); 
                peak.evolvingLock = false;                  
                peak.evolvingMoveSpeed = 0.12;              // lerp factor
            }
        });
    }

    // NEW: Instant evolving alignment (snaps peaks and grains immediately)
    startEvolvingAlignmentInstant(targetList) {
        if (!Array.isArray(targetList) || targetList.length === 0) return;
        this.evolvingActive = true;

        // Ensure helper arrays exist
        while (this._lastPositions.length < this.peaks.length) {
            this._lastPositions.push(new THREE.Vector3());
        }
        while (this._velocities.length < this.peaks.length) {
            this._velocities.push(new THREE.Vector3());
        }

        targetList.forEach(entry => {
            const solid = entry.solid;
            const target = entry.target;
            const peakIndex = this.peakSolids.indexOf(solid);
            if (peakIndex === -1) return;
            const peak = this.peaks[peakIndex];
            if (!peak) return;

            // Calculate delta to move grains relatively
            const delta = new THREE.Vector3().subVectors(target, peak.currentPyramidCenter);

            // INSTANT snap peak center
            peak.currentPyramidCenter.copy(target);

            // INSTANT move all grains by the same delta
            if (Array.isArray(peak.grains)) {
                for (let g = 0; g < peak.grains.length; g++) {
                    const grain = peak.grains[g];
                    if (grain) {
                        grain.position.add(delta);
                        // Zero motion to prevent drift
                        if (grain.userData.velocity) grain.userData.velocity.set(0, 0, 0);
                        if (grain.userData.acceleration) grain.userData.acceleration.set(0, 0, 0);
                    }
                }
            }

            // INSTANT snap solid position
            if (solid) {
                solid.position.x = peak.currentPyramidCenter.x;
                solid.position.z = peak.currentPyramidCenter.z;
            }

            // NEW: Set lock flag to prevent forces from moving peaks
            peak.evolvingLock = true;

            // Zero motion history to prevent velocity spike
            if (this._lastPositions[peakIndex]) {
                this._lastPositions[peakIndex].copy(peak.currentPyramidCenter);
            }
            if (this._velocities[peakIndex]) {
                this._velocities[peakIndex].set(0, 0, 0);
            }
        });
    }
    
    stopEvolvingAlignment() {
        this.evolvingActive = false;
        this.peaks.forEach(p => {
            if (!p) return;
            delete p.evolvingTargetCenter;
            delete p.evolvingLock;
            delete p.evolvingMoveSpeed;
            delete p.manualHeight;
            delete p.evolveBaseY;          
        });
        this.evolveSessionBaseY = null;     
    }
    
        
     update(frequencyData) {
    // Guard clause - don't update if not initialized or no valid data
    if (!this.peaks || this.peaks.length === 0) {
        return; // Exit early if no peaks exist yet
    }

    // Guard clause - handle missing or invalid frequency data
    if (!frequencyData || frequencyData.length === 0) {
        // Use zeros/silence if no audio data available
        frequencyData = new Uint8Array(10);
    }

    this.time += 0.016;
    this.frameCounter++;

    if (this.frameCounter % Math.floor(this.updateInterval / 16) !== 0) {
        return;
    }

    // Initialize state arrays if needed
    while (this._pairStates.length < this.peaks.length) {
        this._pairStates.push({
            partner: -1,
            frames: 0,
            cooldown: 0,
            breakFrames: 0,
            breakDir: new THREE.Vector3(),
            breakGrace: 0,
            breakPartner: -1,
            breakFade: 0,
            breakHeading: new THREE.Vector3(),
            breakEase: 1.0  // NEW: store ease level at break time
        });
    }
    while (this._lastPositions.length < this.peaks.length) {
        this._lastPositions.push(new THREE.Vector3());
    }
    while (this._velocities.length < this.peaks.length) {
        this._velocities.push(new THREE.Vector3());
    }

    // Swarm targets
    let swarmPositions;
    if (this.targetLocked && this.frozenSwarmPositions && this.frozenSwarmPositions.length === this.peaks.length) {
        swarmPositions = this.frozenSwarmPositions;
    } else {
        swarmPositions = generateSwarmPeakPositions(this.peaks.length, this.time);
    }

    // Find and establish pairs
    this._findPairs();

    // Get reference to motion config
    const M = this.motionSystem;

    // Process each peak for movement
    for (let i = 0; i < this.peaks.length; i++) {
        const peak = this.peaks[i];
        if (!peak || !peak.currentPyramidCenter) continue;
        if (this.categoryFilterActive && peak.categoryVisible === false) continue;

        // NEW: Skip ALL movement if stopAllMovement is true (Save Mode)
        if (this.stopAllMovement) {
            continue;
        }

        // Evolving alignment override - LOCK XZ position completely
        if (this.evolvingActive && peak.evolvingLock) {
            // Peak is locked in evolve mode - skip ALL movement logic
            continue;
        }
        
        // Legacy check for smooth alignment (shouldn't happen with instant mode)
        if (peak.evolvingTargetCenter && !peak.evolvingLock) {
            peak.currentPyramidCenter.lerp(peak.evolvingTargetCenter, peak.evolvingMoveSpeed ?? 0.1);
            if (peak.currentPyramidCenter.distanceTo(peak.evolvingTargetCenter) < 0.02) {
                peak.currentPyramidCenter.copy(peak.evolvingTargetCenter);
                peak.evolvingLock = true;
            }
            continue;
        }

        // Base target from swarm pattern
        const baseTarget = swarmPositions[i];

        // Accumulate force offset (positional) instead of velocity
        const forceOffset = new THREE.Vector3();

        // NEW: Track if break happens this frame
        this._pairStates[i].breakThisFrame = false;

        // Apply forces (pairing first so it can flag breaks)
        this._applyPairingForces(i, forceOffset);
        
        // Only apply repulsion if no break happened
        if (!this._pairStates[i].breakThisFrame) {
            this._applyRepulsionForces(i, forceOffset);
        }
        
        this._applyExplorationForces(i, forceOffset, this.time);

        // Apply exponential decay to force offset (reduces oscillation)
        const dampingFactor = 0.85;
        forceOffset.multiplyScalar(dampingFactor);

        // Clamp total force
        if (forceOffset.length() > M.maxOffset) {
            forceOffset.setLength(M.maxOffset);
        }
        
        // NEW: Track velocity and limit it
        if (!this._velocities[i]) this._velocities[i] = new THREE.Vector3();
        const velocity = this._velocities[i];
        
        // Blend swirl target with current position
        const state = this._pairStates[i];
        const swirlWeight = (state && state.partner !== -1) ? (M.swarmWeight * 0.55) : M.swarmWeight;
        const swirlTarget = peak.currentPyramidCenter.clone().lerp(baseTarget, swirlWeight);
        const adjustedTarget = swirlTarget.add(forceOffset);
        
        // Calculate desired velocity from LERP
        const desiredMove = new THREE.Vector3().subVectors(adjustedTarget, peak.currentPyramidCenter);
        const desiredVel = desiredMove.multiplyScalar(M.followLerp);
        
        // Smoothly blend velocity (prevents abrupt changes)
        velocity.lerp(desiredVel, 0.3);
        
        // LIMIT VELOCITY to maxVelocity
        if (velocity.length() > M.maxVelocity) {
            velocity.setLength(M.maxVelocity);
        }
        
        // Apply velocity
        peak.currentPyramidCenter.add(velocity);
    }

    // Update state tracking
    for (let i = 0; i < this.peaks.length; i++) {
        if (this.peaks[i] && this.peaks[i].currentPyramidCenter) {
            if (!this._lastPositions[i]) this._lastPositions[i] = new THREE.Vector3();
            this._lastPositions[i].copy(this.peaks[i].currentPyramidCenter);
        }
    }

    // Grain updates
    this.peaks.forEach((peak, index) => {
        if (!peak || !peak.grains) return;
        if (this.categoryFilterActive && peak.categoryVisible === false) return;

        // Default/audio height for main screen
        const frequencyIndex = index % Math.max(frequencyData.length, 1);
        let targetHeight = frequencyData.length > 0 ? (frequencyData[frequencyIndex] / 256 * 5) : 5;
        if (typeof this.previousHeights[index] !== 'number') this.previousHeights[index] = targetHeight;
        let smoothedHeight = this.previousHeights[index] * 0.8 + targetHeight * 0.2;
        this.previousHeights[index] = smoothedHeight;

        
        let topY = null;
        if (this.evolvingActive) {
            const solid = this.peakSolids[index];
            if (solid) {
                let clearance = solid.userData?.grainClearance;
                let centerOffsetY = solid.userData?.centerOffsetY;
                if (clearance === undefined || centerOffsetY === undefined) {
                    const bb = new THREE.Box3().setFromObject(solid);
                    const size = bb.getSize(new THREE.Vector3());
                    const center = bb.getCenter(new THREE.Vector3());
                    clearance = size.y * 0.5 + this.defaultGrainClearance;
                    centerOffsetY = center.y - solid.position.y;
                    solid.userData.grainClearance = clearance;
                    solid.userData.centerOffsetY = centerOffsetY;
                }
                const centerY = solid.position.y + centerOffsetY;
                topY = centerY - clearance; 
            }
        }

        const GRAIN_THRESHOLD = this.categoryFilterActive ? this.grainsPerVisiblePeak : peak.grains.length;

            for (let j = 0; j < peak.grains.length; j++) {
                const grain = peak.grains[j];
                if (!grain || !grain.userData) continue;
                if ((this.categoryFilterActive && grain.visible === false) || j >= GRAIN_THRESHOLD) continue;

                const { heightFactor, angle, randomization } = grain.userData;
                if (!heightFactor || !angle || !randomization) continue;

                const t = performance.now() * 0.001;

                const minRadius = 0.8 * this.baseRadius;
                const maxRadius = this.baseRadius * 2.5;
                const baseRadius = minRadius + (1 - heightFactor) * (maxRadius - minRadius);

                const wanderAngle = angle
                    + Math.sin(t * (0.15 + 0.4 * randomization[0]) + j) * 2.5
                    + Math.cos(t * (0.2 + 0.3 * randomization[1]) + j * 0.5) * 1.8;

                const wanderRadius = baseRadius
                    + Math.sin(t * (0.12 + 0.2 * randomization[2]) + j * 0.3) * 0.4
                    + Math.cos(t * (0.1 + 0.25 * randomization[3]) + j * 0.25) * 0.5;

                let wanderHeight;

                if (this.evolvingActive && topY !== null) {
                    
                    const baseY = (typeof peak.evolveBaseY === 'number')
                        ? peak.evolveBaseY
                        : (typeof this.evolveSessionBaseY === 'number' ? this.evolveSessionBaseY : 0);

                    const range = Math.max(0.1, topY - baseY); // ensure positive
                    
                    const noise = (
                        Math.sin(t * (0.18 + 0.25 * randomization[1]) + j * 0.2) * 0.12 +
                        Math.cos(t * (0.22 + 0.15 * randomization[2]) + j * 0.15) * 0.08
                    ) * range * 0.2;

                    wanderHeight = baseY + heightFactor * range + noise;
                    // Clamp strictly within [baseY, topY]
                    if (wanderHeight > topY) wanderHeight = topY - 0.02;
                    if (wanderHeight < baseY) wanderHeight = baseY + 0.02;
                } else {
                    // Default main-screen behavior
                    wanderHeight = heightFactor * smoothedHeight
                        + Math.sin(t * (0.18 + 0.25 * randomization[1]) + j * 0.2) * 0.8 * smoothedHeight * 0.3
                        + Math.cos(t * (0.22 + 0.15 * randomization[2]) + j * 0.15) * 0.6 * smoothedHeight * 0.25;
                }

                const vagueTarget = new THREE.Vector3(
                    peak.currentPyramidCenter.x + wanderRadius * Math.cos(wanderAngle),
                    Math.max(0.1, wanderHeight),
                    peak.currentPyramidCenter.z + wanderRadius * Math.sin(wanderAngle)
                );

                if (!grain.userData.velocity) grain.userData.velocity = new THREE.Vector3();
                if (!grain.userData.acceleration) grain.userData.acceleration = new THREE.Vector3();

                const toVague = new THREE.Vector3().subVectors(vagueTarget, grain.position);
                const springStrength = grain.userData.baseAccel * 0.12;
                grain.userData.acceleration.copy(toVague).multiplyScalar(springStrength);

                const fromCenter = new THREE.Vector3().subVectors(grain.position, peak.currentPyramidCenter);
                const distFromCenter = fromCenter.length();
                if (distFromCenter > 0.001) {
                    const up = new THREE.Vector3(0, 1, 0);
                    let orbitDir = new THREE.Vector3().crossVectors(fromCenter, up).normalize();

                    const orbitSpeed = 0.4 + 0.08 * randomization[0];
                    const orbitPhase = t * orbitSpeed + grain.userData.transitionSeed;
                    let orbitAmount = 0.15 + 0.12 * Math.sin(orbitPhase + j * 0.2);

                    if (!grain.userData.orbitDeviation || t - (grain.userData.lastDeviationTime || 0) > 1.5 + Math.random() * 1.5) {
                        grain.userData.orbitDeviation = new THREE.Vector3(
                            (Math.random() - 0.5) * 0.15,
                            (Math.random() - 0.5) * 0.25,
                            (Math.random() - 0.5) * 0.2
                        );
                        grain.userData.lastDeviationTime = t;
                    }
                    orbitDir.add(grain.userData.orbitDeviation.clone().multiplyScalar(0.3)).normalize();

                    grain.userData.acceleration.add(orbitDir.multiplyScalar(orbitAmount));
                    grain.userData.acceleration.y += Math.sin(orbitPhase + j * 0.3) * 0.03;
                }

                grain.userData.velocity.add(grain.userData.acceleration);
                grain.userData.velocity.multiplyScalar(0.88);

                const maxSpeed = grain.userData.maxSpeed * 1.8;
                if (grain.userData.velocity.length() > maxSpeed) {
                    grain.userData.velocity.setLength(maxSpeed);
                }

                grain.position.add(grain.userData.velocity);
            }
    });

    // Update solid positions
    const minSolidLength = Math.min(this.peaks.length, this.peakSolids.length, this.previousHeights.length);
    for (let i = 0; i < minSolidLength; i++) {
        const solid = this.peakSolids[i];
        const peak = this.peaks[i];
        const height = this.previousHeights[i];

        if (!solid || !peak || !peak.currentPyramidCenter || typeof height !== 'number') continue;
        if (this.categoryFilterActive && (peak.categoryVisible === false || solid.visible === false)) continue;

        solid.position.x = peak.currentPyramidCenter.x;
        solid.position.z = peak.currentPyramidCenter.z;

        if (!solid.userData.evolvingManualY) {
            solid.position.y = height + 10;
        }
        
        // ADDED: Update category in userData to match solution
        solid.userData.category =
    solid.userData.solution?.actual_category ??
    solid.userData.solution?.category ??
    solid.userData.solution?.assigned_category ??
    'mid';
    }

    // Update solids' custom animations
    for (let solid of this.peakSolids) {
        if (solid && solid.userData && solid.userData.update) {
            const elapsed = performance.now() * 0.001;
            solid.userData.update(elapsed);
        }
    }

    // Update grid lighting
    this.updateGridLighting();
}

    updateGridLighting() {
        const lightPositions = [];
        const lightIntensities = [];

        for (let i = 0; i < this.peakSolids.length; i++) {
            const solid = this.peakSolids[i];
            if (solid && solid.position && ( !this.categoryFilterActive || solid.visible !== false )) { // <--- respect flag
                lightPositions.push(solid.position.x, solid.position.y, solid.position.z);
                lightIntensities.push(1.5);
            }
        }
        
        for (let i = 0; i < this.peaks.length; i += 2) {
            const peak = this.peaks[i];
            if (peak && peak.currentPyramidCenter && lightIntensities.length < 20) {
                lightPositions.push(
                    peak.currentPyramidCenter.x, 
                    peak.currentPyramidCenter.y + this.previousHeights[i] * 0.5, 
                    peak.currentPyramidCenter.z
                );
                lightIntensities.push(0.6);
            }
        }
        
        while (lightPositions.length < 60) {
            lightPositions.push(0);
        }
        
        while (lightIntensities.length < 20) {
            lightIntensities.push(0);
        }
        
        if (this.scene.userData.dynamicGrid) {
            const material = this.scene.userData.dynamicGrid.material;
            
            const posArray = new Float32Array(lightPositions);
            const intArray = new Float32Array(lightIntensities);
            
            material.uniforms.lightPositions.value = posArray;
            material.uniforms.lightIntensities.value = intArray;
            material.uniforms.maxLights.value = Math.min(lightIntensities.filter(i => i > 0).length, 20);
            
            material.needsUpdate = true;
        }
    }

    static create(scene, baseRadius = 2) {
        return new ParticleSystem(scene, baseRadius);
    }

    getPeakPositions() {
        const positions = [];
        for (let i = 0; i < this.peaks.length; i++) {
            if (this.peaks[i] && this.peaks[i].currentPyramidCenter) {
                positions.push({
                    index: i,
                    position: this.peaks[i].currentPyramidCenter.clone()
                });
            }
        }
        return positions;
    }

    getSolids() {
        // Guard clause - return empty array if not initialized
        if (!this.peakSolids || this.peakSolids.length === 0) {
            return [];
        }
        return this.peakSolids;
    }

    updatePeaks() {
        if (this.stopAllMovement) {
            return;
        }
    }

    updateSolidPositions() {
        if (this.stopAllMovement) {
            return;
        }
    }

    startEvolvingAlignment(targetList) {
    if (!Array.isArray(targetList) || targetList.length === 0) return;
    this.evolvingActive = true;

    targetList.forEach(entry => {
        const solid = entry.solid;
        const target = entry.target;
        const peakIndex = this.peakSolids.indexOf(solid);
        if (peakIndex !== -1 && this.peaks[peakIndex]) {
            const peak = this.peaks[peakIndex];
            peak.evolvingTargetCenter = target.clone();
            peak.evolvingMoveSpeed = 0.12;
            peak.evolvingLock = false; // allow movement
        }
    });
}


    applyCategoryVisibilityBySolids(visibleSolids, grainsPerSolution = 300) {
        this.categoryFilterActive = true;
        this.grainsPerVisiblePeak = grainsPerSolution;

        const visibleSet = new Set(visibleSolids);
        for (let i = 0; i < this.peaks.length; i++) {
            const peak = this.peaks[i];
            const solid = this.peakSolids[i];
            const isVisible = solid ? visibleSet.has(solid) : false;

            if (solid) solid.visible = isVisible;
            if (peak) {
                peak.categoryVisible = isVisible;

                if (Array.isArray(peak.grains)) {
                    for (let g = 0; g < peak.grains.length; g++) {
                        const grain = peak.grains[g];
                        if (!grain) continue;
                       
                        grain.visible = isVisible && g < grainsPerSolution;
                    }
                }
            }
        }
    }

    // Restore everything (deactivate filter)
    clearCategoryVisibility() {
        this.categoryFilterActive = false;               
        for (let i = 0; i < this.peaks.length; i++) {
            const peak = this.peaks[i];
            const solid = this.peakSolids[i];

            if (solid) solid.visible = true;
            if (peak) {
                peak.categoryVisible = true;
                if (Array.isArray(peak.grains)) {
                    for (let g = 0; g < peak.grains.length; g++) {
                        const grain = peak.grains[g];
                        if (grain) grain.visible = true;
                    }
                }
            }
        }
    }

    // Find and establish pairs
_findPairs() {
    const M = this.motionSystem;

    // Clear cooldowns and decay grace
    for (let i = 0; i < this._pairStates.length; i++) {
        const state = this._pairStates[i];
        if (state.cooldown > 0) state.cooldown--;
        if (state.breakGrace > 0) {
            state.breakGrace--;
            if (state.breakGrace === 0) state.breakPartner = -1;
        }
    }

    // NEW: Rebuild spatial grid (O(N))
    this.spatialGrid.clear();
    for (let i = 0; i < this.peaks.length; i++) {
        const peak = this.peaks[i];
        if (peak?.currentPyramidCenter) {
            this.spatialGrid.insert(i, peak.currentPyramidCenter);
        }
    }

    // Check existing pairs for distance-based breaks (O(P) where P = number of pairs)
    for (let i = 0; i < this._pairStates.length; i++) {
        const state = this._pairStates[i];
        const partnerIdx = state.partner;
        if (partnerIdx === -1) continue;

        const partnerState = this._pairStates[partnerIdx];
        const A = this.peaks[i]?.currentPyramidCenter;
        const B = this.peaks[partnerIdx]?.currentPyramidCenter;
        if (!A || !B || !partnerState) continue;

        const dist = A.distanceTo(B);
        if (dist > (M.pairKeepRadius ?? Infinity)) {
            const grace = M.breakGraceFrames || 0;

            // Set grace on both
            state.breakGrace = grace;
            state.breakPartner = partnerIdx;
            partnerState.breakGrace = grace;
            partnerState.breakPartner = i;

            // Symmetric unpair + cooldown
            state.partner = -1;
            state.frames = 0;
            state.cooldown = M.pairCooldown;

            partnerState.partner = -1;
            partnerState.frames = 0;
            partnerState.cooldown = M.pairCooldown;
        }
    }

    // Try to form new pairs using spatial grid (O(N * k) where k = avg neighbors per cell)
    for (let i = 0; i < this.peaks.length; i++) {
        const state = this._pairStates[i];
        if (state.partner !== -1 || state.cooldown > 0) continue;

        const peakA = this.peaks[i];
        if (!peakA || !peakA.currentPyramidCenter) continue;
        const solidA = this.peakSolids[i];
        const catA = solidA?.userData?.solution?.actual_category ??
                     solidA?.userData?.solution?.assigned_category;
        if (!catA) continue;

        let bestPartner = -1;
        let bestDist = M.pairFormRadius;

        // NEW: Only check nearby peaks (spatial query)
        const nearbyIndices = this.spatialGrid.getNearby(
            peakA.currentPyramidCenter, 
            M.pairFormRadius
        );

        for (const j of nearbyIndices) {
            if (i === j) continue;
            const stB = this._pairStates[j];
            if (stB.partner !== -1 || stB.cooldown > 0) continue;

            const peakB = this.peaks[j];
            if (!peakB || !peakB.currentPyramidCenter) continue;

            const solidB = this.peakSolids[j];
            const catB = solidB?.userData?.solution?.actual_category ??
                         solidB?.userData?.solution?.assigned_category;

            if (!(catB && (complementary_map[catA] === catB || complementary_map[catB] === catA))) continue;

            const dist = peakA.currentPyramidCenter.distanceTo(peakB.currentPyramidCenter);
            if (dist <= bestDist) {
                bestDist = dist;
                bestPartner = j;
            }
        }

        if (bestPartner !== -1) {
            state.partner = bestPartner;
            state.frames = 0;
            this._pairStates[bestPartner].partner = i;
            this._pairStates[bestPartner].frames = 0;

            const pairIndex = Math.min(i, bestPartner);
            if (!this._pairDirections[pairIndex]) {
                this._pairDirections[pairIndex] = new THREE.Vector3(
                    Math.random() - 0.5, 0, Math.random() - 0.5
                ).normalize();
            }
        }
    }
}

// Apply repulsion/attraction forces
_applyRepulsionForces(index, forceOffset) {
    const peak = this.peaks[index];
    const M = this.motionSystem;
    const myState = this._pairStates[index];
    const myPartner = myState?.partner;

    // NEW: Only check nearby peaks (spatial query) - REPLACES the full loop
    const searchRadius = Math.max(M.minSeparation, M.complementaryRange);
    const nearbyIndices = this.spatialGrid.getNearby(
        peak.currentPyramidCenter,
        searchRadius
    );

    // CHANGED: Loop only through nearby peaks instead of ALL peaks
    for (const j of nearbyIndices) {
        if (index === j) continue;
        const other = this.peaks[j];
        if (!other || !other.currentPyramidCenter) continue;

        const delta = new THREE.Vector3().subVectors(peak.currentPyramidCenter, other.currentPyramidCenter);
        const dist = delta.length();
        if (dist < 0.0001) continue;

        // Fade interactions with the most-recent ex-partner after break
        let graceScale = 1.0;
        if (myState && myState.breakGrace > 0 && j === myState.breakPartner) {
            const t = myState.breakGrace / Math.max(1, M.breakGraceFrames);
            graceScale = 1 - t;
        }

        // Reduce repulsion between paired members
        let repulsionScale = 1.0;
        if (myPartner !== -1 && j === myPartner) {
            repulsionScale = 0.4;
        }

        // Repulsion
        if (dist < M.minSeparation) {
            const push = (1 - dist / M.minSeparation) * M.repulsionStrength * M.repulsionWeight * graceScale * repulsionScale;
            forceOffset.addScaledVector(delta.normalize(), push * M.minSeparation);
        }

        // Complementary attraction
        const solidA = this.peakSolids[index];
        const solidB = this.peakSolids[j];
        if (solidA && solidB) {
            const catA = solidA.userData?.solution?.actual_category;
            const catB = solidB.userData?.solution?.actual_category;
            if (catA && catB && (complementary_map[catA] === catB || complementary_map[catB] === catA)) {
                if (myPartner !== -1 && j !== myPartner) continue;

                const inner = M.minSeparation * 1.2;
                if (dist < M.complementaryRange && dist > inner) {
                    let t = (dist - inner) / Math.max(1e-6, (M.complementaryRange - inner));
                    t = Math.min(Math.max(t, 0), 1);
                    const smooth = (1 - t) * (1 - t);
                    const pull = M.complementaryPull * M.attractionWeight * smooth * graceScale;
                    forceOffset.addScaledVector(delta.normalize(), -pull * M.minSeparation);
                }
            }
        }
    }
}

// Apply pairing forces
_applyPairingForces(index, forceOffset) {
    const peak = this.peaks[index];
    const state = this._pairStates[index];
    const M = this.motionSystem;

    while (this._pairDirections.length < this.peaks.length) {
        this._pairDirections.push(new THREE.Vector3(Math.random()-0.5, 0, Math.random()-0.5).normalize());
    }

    if (state.partner !== -1) {
        state.frames++;
        const partner = this.peaks[state.partner];
        if (!partner?.currentPyramidCenter) return;

        const toPartner = new THREE.Vector3().subVectors(partner.currentPyramidCenter, peak.currentPyramidCenter);
        const dist = toPartner.length();
        if (dist < 1e-6) return;

        const u = toPartner.normalize();

        // === BOIDS FLOCKING: 3 forces ===
        
        // 1. SEPARATION: maintain desired spacing
        const separationError = dist - M.pairDesiredSeparation;
        
        if (dist < M.pairDesiredSeparation) {
            // Too close: push apart
            const proximity = 1 - (dist / M.pairDesiredSeparation); // 1 at overlap, 0 at desired
            const separationForce = proximity * M.pairSeparationStrength * M.pairingWeight;
            forceOffset.addScaledVector(u, -separationForce); // push away
        } else if (dist > M.pairDesiredSeparation * 1.5) {
            // Too far: pull together (cohesion kicks in)
            const excess = dist - M.pairDesiredSeparation;
            const cohesionForce = (excess / M.pairDesiredSeparation) * M.pairSeparationStrength * 0.5 * M.pairingWeight;
            forceOffset.addScaledVector(u, cohesionForce); // pull closer
        }

        // 2. COHESION: pull toward shared center (explicit flocking behavior)
        const midpoint = new THREE.Vector3()
            .addVectors(peak.currentPyramidCenter, partner.currentPyramidCenter)
            .multiplyScalar(0.5);
        
        const toMidpoint = new THREE.Vector3().subVectors(midpoint, peak.currentPyramidCenter);
        const cohesionForce = M.pairCohesionStrength * M.pairingWeight;
        forceOffset.addScaledVector(toMidpoint.normalize(), cohesionForce);

        // 3. ALIGNMENT: match heading with partner
        const pairIndex = Math.min(index, state.partner);
        const heading = this._pairDirections[pairIndex];

        // Update shared heading (only once per pair)
        if (index === pairIndex) {
            // Desired heading = tangent to circular motion around origin
            const center = new THREE.Vector3()
                .addVectors(peak.currentPyramidCenter, partner.currentPyramidCenter)
                .multiplyScalar(0.5);
            const radial = center.clone().setY(0);
            
            let tangent = new THREE.Vector3(1, 0, 0);
            if (radial.lengthSq() > 1e-6) {
                tangent.crossVectors(radial, new THREE.Vector3(0, 1, 0)).normalize();
            }

            // Blend LESS with actual velocities (they lag behind desired heading)
            const myVel = new THREE.Vector3().subVectors(
                peak.currentPyramidCenter, 
                this._lastPositions[index] || peak.currentPyramidCenter
            );
            const partnerVel = new THREE.Vector3().subVectors(
                partner.currentPyramidCenter,
                this._lastPositions[state.partner] || partner.currentPyramidCenter
            );
            const avgVel = new THREE.Vector3().addVectors(myVel, partnerVel);
            
            if (avgVel.lengthSq() > 1e-6) {
                // CHANGED: 85% tangent, 15% actual velocity (was 60/40)
                // This prioritizes the desired direction over current momentum
                tangent.multiplyScalar(M.headingTangentWeight || 0.85)
                    .addScaledVector(avgVel.normalize(), M.headingVelocityWeight || 0.15)
                    .normalize();
            }

            // Occasional jitter
            if (state.frames % M.pairJitterInterval === 0) {
                const jitterRad = (M.pairHeadingJitter * Math.PI / 180) * (Math.random() - 0.5);
                const cos = Math.cos(jitterRad);
                const sin = Math.sin(jitterRad);
                tangent.set(
                    tangent.x * cos - tangent.z * sin,
                    0,
                    tangent.x * sin + tangent.z * cos
                ).normalize();
            }

            // Smooth heading update
            heading.lerp(tangent, M.pairHeadingSmoothing).normalize();
        }

        // Apply alignment and travel forces
        const easeProgress = Math.min(1, state.frames / Math.max(1, M.pairEaseFrames));
        const ease = easeProgress * easeProgress * (3 - 2 * easeProgress);

        // CHANGED: Apply forces separately with different weights
        const alignForce = ease * M.pairAlignmentStrength * M.pairingWeight;
        const travelForce = ease * M.pairTravelSpeed * M.pairingWeight;
        
        // Alignment: steer toward heading
        forceOffset.addScaledVector(heading, alignForce);
        
        // Travel: move forward along heading
        forceOffset.addScaledVector(heading, travelForce);

        // Minimal wander (don't break alignment)
        forceOffset.x += (Math.random() - 0.5) * M.wanderInPair * 0.5; // REDUCED influence (was 1.0)
        forceOffset.z += (Math.random() - 0.5) * M.wanderInPair * 0.5;

        // Check for break
        if (state.frames > M.pairMinFrames && Math.random() < M.pairBreakProb) {
            this._breakPair(index, state.partner, heading.clone(), ease);
        }

    } else {
        // Solo: fade out pair forces after break
        if (state.breakFade > 0 && state.breakHeading?.lengthSq() > 1e-6) {
            const fadeProgress = state.breakFade / Math.max(1, M.breakGraceFrames);
            const storedEase = state.breakEase || 1.0;

            const alignForce = fadeProgress * storedEase * M.pairAlignmentStrength * M.pairingWeight;
            const travelForce = fadeProgress * storedEase * M.pairTravelSpeed * M.pairingWeight;
            
            forceOffset.addScaledVector(state.breakHeading, alignForce + travelForce);
            state.breakFade--;
        }

        // Exploration: ramp up as pair forces fade
        const explorationScale = state.breakFade > 0 
            ? (1 - state.breakFade / Math.max(1, M.breakGraceFrames))
            : 1.0;
        
        forceOffset.x += (Math.random() - 0.5) * M.wanderStrength * explorationScale;
        forceOffset.z += (Math.random() - 0.5) * M.wanderStrength * explorationScale;
    }
}
// Helper method to break a pair cleanly
_breakPair(indexA, indexB, currentHeading, currentEase) {
    const M = this.motionSystem;
    const grace = M.breakGraceFrames || 0;

    // Break member A
    const stateA = this._pairStates[indexA];
    stateA.partner = -1;
    stateA.frames = 0;
    stateA.cooldown = M.pairCooldown;
    stateA.breakGrace = grace;
    stateA.breakPartner = indexB;
    stateA.breakFade = grace;
    stateA.breakHeading.copy(currentHeading);
    stateA.breakEase = currentEase;
    stateA.breakThisFrame = true;

    // Break member B
    const stateB = this._pairStates[indexB];
    if (stateB) {
        stateB.partner = -1;
        stateB.frames = 0;
        stateB.cooldown = M.pairCooldown;
        stateB.breakGrace = grace;
        stateB.breakPartner = indexA;
        stateB.breakFade = grace;
        stateB.breakHeading.copy(currentHeading);
        stateB.breakEase = currentEase;
        stateB.breakThisFrame = true;
    }
}
// Apply exploration forces  
_applyExplorationForces(index, forceOffset, time) {
    const peak = this.peaks[index];
    const M = this.motionSystem;
    const state = this._pairStates[index];
    const isPaired = state && state.partner !== -1;

    // 1. REDUCE EXPLORATION WHEN PAIRED (so pair heading dominates)
    const scale = isPaired ? M.explorationPairedScale : 1.0;

    // 2. CIRCULAR DRIFT (orbit around origin)
    const seed = peak.exploreSeed || 0;
    const orbitAngle = time * 0.07 + seed * 0.013;
    const orbitRadius = 40;
    
    const circularDrift = new THREE.Vector3(
        Math.cos(orbitAngle) * orbitRadius,
        0,
        Math.sin(orbitAngle) * orbitRadius
    );
    
    // Apply as force (not position), scaled by circular bias
    const circularForce = M.circularBias * M.explorationWeight * scale;
    forceOffset.addScaledVector(circularDrift.normalize(), circularForce);

    // 3. NOISE WANDER (random walk)
    const noisePhase = time * 0.12 + seed * 0.3;
    const noiseX = Math.sin(noisePhase * 1.31 + seed * 0.2);
    const noiseZ = Math.cos(noisePhase * 1.17 + seed * 0.35);
    
    forceOffset.x += noiseX * M.wanderStrength * scale;
    forceOffset.z += noiseZ * M.wanderStrength * scale;

    // 4. BOUNDARY FORCES
    const radial = peak.currentPyramidCenter.clone().setY(0);
    const radialLen = radial.length();

    // Soft outer boundary (push inward when too far)
    if (radialLen > M.maxRange) {
        const excess = radialLen - M.maxRange;
        const pushInward = excess * 0.05;
        forceOffset.addScaledVector(radial.normalize(), -pushInward);
    }

    // Center avoidance (push outward when too close to origin)
    if (radialLen < M.avoidCenterRadius) {
        const proximity = 1 - (radialLen / M.avoidCenterRadius); // 1 at center, 0 at radius
        const pushOutward = proximity * proximity * M.avoidCenterStrength; // quadratic falloff
        
        if (radialLen > 1e-4) {
            forceOffset.addScaledVector(radial.normalize(), pushOutward);
        } else {
            // Exactly at center - pick random outward direction
            const randomDir = new THREE.Vector3(
                Math.random() - 0.5,
                0,
                Math.random() - 0.5
            ).normalize();
            forceOffset.addScaledVector(randomDir, M.avoidCenterStrength);
        }
    }
}
}

