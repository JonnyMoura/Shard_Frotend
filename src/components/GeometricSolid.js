import * as THREE from 'three';

export function createGeometricSolid(solution, renderer, onMaterialReady) {
    const audioParams = solution.parameters;
    const descriptors = solution.descriptors;
    
    console.log(`🎨 Creating solid for solution ${solution.id} with real parameters:`, audioParams);
    
    // CHANGED: More dramatic base radius variation (was 1.5-6.0, now 1.2-7.5)
    const baseRadius = THREE.MathUtils.mapLinear(audioParams.room_size, 0.01, 0.4, 1.2, 7.5);
    const geometry = new THREE.IcosahedronGeometry(2.5, 2);

    // --- Vertex welding with INCREASED deformation ---
    const pos = geometry.attributes.position;
    const vertexMap = new Map();
    for (let i = 0; i < pos.count; i++) {
        const key = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
        if (!vertexMap.has(key)) vertexMap.set(key, []);
        vertexMap.get(key).push(i);
    }
    vertexMap.forEach(indices => {
        const i = indices[0];
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const len = Math.sqrt(x * x + y * y + z * z);
        const nx = x / len;
        const ny = y / len;
        const nz = z / len;
        
        const pitchVarianceNormalized = (audioParams.pitch_variance + 0.05) / 0.1; // 0-1 range
        const spectralFluxNormalized = Math.min(descriptors.spectral_flux / 1700, 1); // 0-1 range
        
        // CHANGED: Much more dramatic deformation (was 2.5 and 1.4, now 5.0 and 3.5)
        const deform = (Math.random() - 0.5) * pitchVarianceNormalized * 4.0
                     + (Math.random() - 0.5) * spectralFluxNormalized * 3.5;
        
        for (const idx of indices) {
            pos.setXYZ(idx, x + nx * deform, y + ny * deform, z + nz * deform);
        }
    });
    geometry.computeVertexNormals();

    // --- Color calculation with DISTINCT category color families ---
    const wetLevelNormalized = (audioParams.wet_level - 0.05) / 0.25; // 0-1 range
    const overlapNormalized = Math.min((audioParams.overlap - 0.5) / 9.5, 1); // 0-1 range
    const grainDurationNormalized = (audioParams.grain_duration - 0.1) / 0.9; // 0-1 range
    const pitchVarianceNormalized = (audioParams.pitch_variance + 0.05) / 0.1; // 0-1 range
    
    // FIXED: Try multiple possible category locations
    const rawCategory =
        solution.actual_category ??
        solution.category ??
        solution.assigned_category ??
        solution.descriptors?.category ??
        'mid';

    const category = typeof rawCategory === 'string'
        ? rawCategory.toLowerCase()
        : 'mid';

    // ADDED: Debug logging to see what category we're actually getting
    console.log(`🎨 Solution ${solution.id}: category="${solution.category}", assigned="${solution.assigned_category}", using="${category}"`);
    
    let hueBase, hueSpan, lightBase, lightSpan, satBase;
    switch (category) {
        case 'low':
            hueBase = 0.60; hueSpan = 0.02;
            lightBase = 0.20; lightSpan = 0.10;
            satBase = 0.55;
            break;
        case 'mid':
            hueBase = 0.77; hueSpan = 0.02;
            lightBase = 0.26; lightSpan = 0.12;
            satBase = 0.60;
            break;
        case 'high':
            hueBase = 0.52; hueSpan = 0.02;
            lightBase = 0.42; lightSpan = 0.12;
            satBase = 0.70;
            break;
        case 'rhythmic':
            hueBase = 0.40; hueSpan = 0.015;
            lightBase = 0.50; lightSpan = 0.10;
            satBase = 0.75;
            break;
        default:
            hueBase = 0.77; hueSpan = 0.02;
            lightBase = 0.26; lightSpan = 0.12;
            satBase = 0.60;
    }
    const baseHue = hueBase + hueSpan * (1 - wetLevelNormalized) * 0.3;
    const baseSaturation = Math.min(satBase + 0.15 * overlapNormalized, 0.9);
    const baseLightness = lightBase + lightSpan * (grainDurationNormalized * 0.4 + pitchVarianceNormalized * 0.2);
    
    const wireframeColor = new THREE.Color().setHSL(baseHue, baseSaturation, baseLightness);
    
    console.log(`🎨 Color for ${category}: H=${baseHue.toFixed(2)}, S=${baseSaturation.toFixed(2)}, L=${baseLightness.toFixed(2)}`);

    const material = new THREE.MeshStandardMaterial({
        color: wireframeColor,
        wireframe: true,
        transparent: false,
        opacity: 0.6 + 0.3 * grainDurationNormalized,
        emissive: wireframeColor.clone().multiplyScalar(0.2),
        emissiveIntensity: 0.2 + grainDurationNormalized * 0.7 + pitchVarianceNormalized * 0.3,
        metalness: 0.6 + overlapNormalized * 0.3,
        roughness: 0.2 + (1 - wetLevelNormalized) * 0.5,
        flatShading: false,
        fog: true,
        side: THREE.DoubleSide
    });

    // Stabilize color updates
    const stableColor = wireframeColor.clone();
    material.color = stableColor;

    // Create mesh
    const mesh = new THREE.Mesh(geometry, material);
    
    // CHANGED: Much more dramatic Y-scale variation (was 1.0-1.5, now 0.8-2.5)
    mesh.scale.y = 0.8 + grainDurationNormalized * 1.7;
    mesh.layers.enable(1);

    // **Store solution data with the mesh**
    mesh.userData.solution = solution;
    mesh.userData.solutionId = solution.id;
    mesh.userData.audioParams = audioParams;
    mesh.userData.descriptors = descriptors;
    mesh.userData.fitness = solution.fitness;
    mesh.userData.category = category;

    // --- Orbiting clones with MORE variation ---
    if (audioParams.num_voices > 1) {
        const group = new THREE.Group();
        group.add(mesh);

        group.userData.solution = solution;
        group.userData.solutionId = solution.id;
        group.userData.audioParams = audioParams;
        group.userData.descriptors = descriptors;
        group.userData.fitness = solution.fitness;
        group.userData.category = category;

        group.userData.orbitClones = [];
        // CHANGED: Reduced distance - balanced between too close and too far
        // Add smaller base offset plus moderate scaling
        group.userData.orbitBaseRadius = 5 + baseRadius * 2.2; // Was 8 + baseRadius * 3.5
        group.userData.orbitSpeed = 0.15 + Math.random() * 0.15; 

        const maxClones = Math.min(Math.floor(audioParams.num_voices), 8); 

        for (let i = 1; i < maxClones; i++) {
            const clone = mesh.clone();
            clone.position.y = Math.random() * 0.8;
            
            const overlapForScale = Math.min((audioParams.overlap - 0.5) / 9.5, 1);
            const cloneScale = 0.12 + (overlapForScale * 0.23);
            clone.scale.set(cloneScale, cloneScale, cloneScale);
            
            clone.userData.orbitAngle = (i / maxClones) * Math.PI * 2;
            clone.userData.mass = cloneScale * cloneScale;
            clone.userData.orbitalVelocity = 0.1 + (1 - cloneScale) * 0.1;
            clone.userData.verticalOscillation = cloneScale * 0.3;
            
            clone.material = material.clone();
            clone.material.envMap = material.envMap;
            
            // CHANGED: More dramatic saturation shift for clones
            const hueShift = (i / maxClones) * 0.01;
            const saturationBoost = (i / maxClones) * 0.10;
            const lightnessBoost = (i / maxClones) * 0.05;
            
            clone.material.color.setHSL(
                baseHue + hueShift, 
                Math.min(baseSaturation * 0.7 + saturationBoost, 0.95), // More saturation range
                Math.min(baseLightness + lightnessBoost, 0.6)  // Brighter clones but capped
            );
            clone.material.emissive = clone.material.color.clone().multiplyScalar(0.15);
            
            clone.layers.enable(1);
            
            clone.material.emissiveIntensity = 0.25 + grainDurationNormalized * 0.25 + (i / maxClones) * 0.2;
            
            group.add(clone);
            group.userData.orbitClones.push(clone);
        }

        group.userData.update = function (elapsed) {
            mesh.rotation.y = elapsed * 0.2;
            
            for (let i = 0; i < group.userData.orbitClones.length; i++) {
                const clone = group.userData.orbitClones[i];
                const baseAngle = clone.userData.orbitAngle + elapsed * group.userData.orbitSpeed;
                
                const mass = clone.userData.mass;
                const orbitalVel = clone.userData.orbitalVelocity;
                const verticalOsc = clone.userData.verticalOscillation;
                
                const angle = baseAngle + Math.sin(elapsed * orbitalVel) * (1 - mass) * 0.3;
                // CHANGED: Increased radius multiplier for more spacing
                const radius = group.userData.orbitBaseRadius * (0.9 + mass * 0.5); // Was 0.8 + mass * 0.4
                
                clone.position.x = Math.cos(angle) * radius;
                clone.position.z = Math.sin(angle) * radius;
                clone.position.y = Math.sin(elapsed * 1.5 + i) * verticalOsc * 0.5;
                
                clone.rotation.z = -angle * (2 - mass);
                clone.rotation.y = elapsed * 0.3 * (2 - mass);
            }
        };

        return group;
    }

    mesh.userData.update = function (elapsed) {
        mesh.rotation.z = elapsed * 0.2;
    };

    return mesh;
}