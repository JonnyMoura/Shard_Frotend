import * as THREE from 'three';
import { Library } from './Library.js'; // Add this line
import { Button } from './Button.js';

export class SaveMode {
    constructor(mainRenderer, mainCamera, controls, particleSystem, library = null) {
        this.mainRenderer = mainRenderer;
        this.mainCamera = mainCamera;
        this.controls = controls;
        this.particleSystem = particleSystem;
        
        this.solidMeshes = this.particleSystem.getSolids ? this.particleSystem.getSolids() : [];
        this.isSaveMode = false;
        this.selectedSolid = null;
        this.selectedSolidIndex = -1;
        this.hoveredSolid = null;
        this.hoveredSolidIndex = -1;
        this.originalPositions = [];
        this.saveToLibraryBtn = null;
        this.saveCombinationBtn = null;
        this.selectedSolids = [];
        this.boundingBoxHelpers = []; // Store bounding box helpers
        this._saveLabelTexture = null;
        this._hoverCooldown = new WeakMap();
         this._saveModePlayingIds = new Set();
    
        
        // NEW: Cache materials IMMEDIATELY on construction (before any modifications)
        this._globalMaterialCache = new WeakMap(); // mesh -> original material
        this._cacheAllMaterialsNow();

        // Track currently playing sound in Save mode
        this._saveModePlayingId = null;

        
        if (library) {
            this.library = library;
        } else {
            console.error('No library provided to SaveMode');
            return;
        }

        this.createSaveButton();
        this.setupInteractions();
    }
    
    // NEW: Cache ALL materials immediately on construction
    _cacheAllMaterialsNow() {
        if (!this.particleSystem?.getSolids) return;
        
        const solids = this.particleSystem.getSolids();
        solids.forEach(solid => {
            solid.traverse(child => {
                if (child.isMesh && !this._globalMaterialCache.has(child)) {
                    // Store the ORIGINAL material (current state before ANY modifications)
                    this._globalMaterialCache.set(child, child.material);
                }
            });
        });
        console.log('✅ Global material cache initialized:', this._globalMaterialCache.size, 'meshes');
    }
    
    createSaveButton() {
        this.saveBtn = new Button('SAVE', 'hamburger', () => {});
        
        // NEW: Create close button for Save mode
        this.createCloseButton();
    }

    // NEW: Create close button
    createCloseButton() {
        this.closeBtn = document.createElement('button');
        this.closeBtn.className = 'mode-close-btn save-mode-close';
        this.closeBtn.innerHTML = '×';
        this.closeBtn.title = 'Exit Save Mode';
        this.closeBtn.style.display = 'none';
        
        this.closeBtn.onclick = () => {
            if (this.isSaveMode) {
                this.exitSaveMode();
                if (window.modeManager) {
                    window.modeManager.goTo(null); // FIXED: Use goTo instead of setMode
                }
            }
        };
        
        document.body.appendChild(this.closeBtn);
    }
    
    toggleSaveMode() {
        if (this.isSaveMode) {
            this.exitSaveMode();
        } else {
            this.enterSaveMode();
        }
    }
    
   
    enterSaveMode() {
        // Guard clause
        if (!this.particleSystem.peaks || this.particleSystem.peaks.length === 0) {
            console.warn('⚠️ Cannot enter save mode - no peaks initialized');
            return;
        }

        console.log('💾 Entering save mode');
        this.isSaveMode = true;

        // Fade out main soundscape and stop sequencing; clear any previous green highlights
        try {
            
            this.particleSystem?.surroundController?.startMode(500);
      
            this.particleSystem?.surroundController?.clearAllGreenOutlines();
        } catch {}

        // Reset Save-mode playing tracker
        this._saveModePlayingId = null;

       
        this.solidMeshes = this.particleSystem.getSolids();
        
        // Refresh cache in case new solids were added
        this._cacheAllMaterialsNow();
        
        this._hoverCooldown = new WeakMap();

        
        this.saveBtn.setSelected(true);

        
        this.originalPositions = [];
        for (let i = 0; i < this.solidMeshes.length; i++) {
            const solid = this.solidMeshes[i];
            this.originalPositions.push({
                position: solid.position.clone(),
                rotation: solid.rotation.clone()
            });
            
           
            solid.userData.frozenPosition = solid.position.clone();
            solid.userData.frozenRotation = solid.rotation.clone();
        }

      
        this.particleSystem.targetLocked = true;
        this.particleSystem.stopAllMovement = true;
        
        
        this.particleSystem.peaks.forEach((peak, index) => {
            peak.lockedCenter = peak.currentPyramidCenter.clone();
            peak.readyForNextMove = false;
            peak.lockedHeight = this.particleSystem.previousHeights[index] || 5;
            peak.frozen = true;
        });

        this.particleSystem.frozenSwarmPositions = this.particleSystem.peaks.map(
            peak => peak.currentPyramidCenter.clone()
        );

       
        this.mainRenderer.domElement.addEventListener('click', this.onMouseClick);
        this.mainRenderer.domElement.addEventListener('mousemove', this.onMouseMove);
        
        // NEW: Show close button
        if (this.closeBtn) {
            this.closeBtn.style.display = 'block';
        }
        
        console.log('✅ Entered Save Mode - All movement stopped, solids frozen in place');
    }
    
   
    exitSaveMode() {
        if (!this.isSaveMode) return;
        console.log('🚪 Exiting Save Mode...');
        
        this.isSaveMode = false;

        // CRITICAL: Stop ALL audio FIRST
        try {
            this.particleSystem?.surroundController?.stopAllManualPlayback();
        } catch (e) {
            console.error('Failed to stop audio on save exit:', e);
        }

        // STEP 2: Update UI
        this.saveBtn.setSelected(false);
      

        // STEP 3: Remove event listeners
        this.mainRenderer.domElement.removeEventListener('click', this.onMouseClick);
        this.mainRenderer.domElement.removeEventListener('mousemove', this.onMouseMove);

        // STEP 4: Clear hover state
        this.hoveredSolid = null;
        this.hoveredSolidIndex = -1;
        this.mainRenderer.domElement.style.cursor = 'default';

        // STEP 5: ATOMIC material cleanup
        this._atomicMaterialCleanup();

        // STEP 6: Unfreeze movement
        this.particleSystem.targetLocked = false;
        this.particleSystem.stopAllMovement = false;
        
        this.particleSystem.peaks.forEach(peak => {
            peak.frozen = false;
            peak.readyForNextMove = true;
        });

        // STEP 7: Reset trackers
        this._hoverCooldown = new WeakMap();
        this._baseMaterialsCached = false;
        
        // NEW: Hide close button
        if (this.closeBtn) {
            this.closeBtn.style.display = 'none';
        }
        
       
        
        console.log('✅ Save Mode exited cleanly');
    }

    // NEW: Single atomic cleanup function that does EVERYTHING
    _atomicMaterialCleanup() {
        console.log('🧹 Starting atomic material cleanup');
        
        // Track what we're cleaning
        let cleanedMeshes = 0;
        let restoredMaterials = 0;
        
        this.solidMeshes.forEach(solid => {
            if (!solid) return;
            
            // Remove UI elements for this solid
            if (solid.userData.saveToLibraryBtn) {
                solid.userData.saveToLibraryBtn.remove();
                solid.userData.saveToLibraryBtn = null;
            }
            if (solid.userData.save3DIcon) {
                this.particleSystem.scene.remove(solid.userData.save3DIcon);
                solid.userData.save3DIcon = null;
            }
            if (solid.userData.saveConnectionLine) {
                this.particleSystem.scene.remove(solid.userData.saveConnectionLine);
                this.particleSystem.scene.remove(solid.userData.saveConnectionLine);
                solid.userData.saveConnectionLine.geometry?.dispose();
                solid.userData.saveConnectionLine.material?.dispose();
                solid.userData.saveConnectionLine = null;
            }
            if (solid.userData.saveLabelSprite) {
                solid.userData.saveLabelSprite = null;
            }
            
            // Clear flags
            delete solid.userData.__saveModeSelected;
            
            // Restore materials for all child meshes
            solid.traverse(child => {
                if (!child.isMesh) return;
                
                cleanedMeshes++;
                
                // Get the ORIGINAL cached material
                const originalMaterial = this._globalMaterialCache.get(child);
                if (originalMaterial) {
                    child.material = originalMaterial;
                    restoredMaterials++;
                }

                // Clean up CSS classes
                if (child.element) {
                    child.element.classList.remove('selected-solid', 'hovered-solid', 'hovered-aura');
                }

                // Delete ALL temporary material references
                delete child.userData.__saveModeMaterialTint;
                delete child.userData.__saveModeMaterialOriginal;
                delete child.userData.__surroundPlayOriginal;
                delete child.userData.__surroundOriginalMaterial;
                delete child.userData.__saveModeBaseMaterial;
                delete child.userData.__saveModeOriginalMaterial;
            });
        });
        
        // Clear selection array
        this.selectedSolids = [];
        
        // Remove combination button
        if (this.saveCombinationBtn) {
            this.saveCombinationBtn.remove();
            this.saveCombinationBtn = null;
        }
        
        console.log(`✅ Cleaned ${cleanedMeshes} meshes, restored ${restoredMaterials} materials`);
    }

    forceReset({ restoreMaterials = true } = {}) {
        console.log('🔄 Force reset called');
        
        // Only do cleanup if we're actually in save mode
        if (!this.isSaveMode) {
            console.log('⏭️ Not in save mode, skipping reset');
            return;
        }
        
        // Use the same atomic cleanup
        this._atomicMaterialCleanup();
        
        this._hoverCooldown = new WeakMap();
        this.selectedSolids = [];
    }

    //Helper function to create Bounding boxes
    createBoundingBoxes() {
        // Remove any existing bounding boxes first
        this.removeBoundingBoxes();

        for (let i = 0; i < this.solidMeshes.length; i++) {
            const solid = this.solidMeshes[i];
            
            // Calculate bounding box
            const box = new THREE.Box3().setFromObject(solid);
            
            // Create wireframe geometry for the bounding box
            const size = new THREE.Vector3();
            box.getSize(size);
            const center = new THREE.Vector3();
            box.getCenter(center);
            
            // Create box geometry at origin
            const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
            
            // Create wireframe material
            const boxMaterial = new THREE.MeshBasicMaterial({
                color: 0x00ff00,
                wireframe: true,
                transparent: true,
                opacity: 0.5
            });
            
            // Create mesh
            const boxHelper = new THREE.Mesh(boxGeometry, boxMaterial);
            
            // Position the box at the center of the bounding box
            boxHelper.position.copy(center);
            
            // Add to scene
            this.particleSystem.scene.add(boxHelper);
            
            // Store reference
            this.boundingBoxHelpers.push(boxHelper);
            
            console.log(`Created bounding box for solid ${i}:`, {
                center: center,
                size: size
            });
        }
    }

    removeBoundingBoxes() {
        // Remove all bounding box helpers from the scene
        for (let helper of this.boundingBoxHelpers) {
            this.particleSystem.scene.remove(helper);
            helper.geometry.dispose();
            helper.material.dispose();
        }
        this.boundingBoxHelpers = [];
        this._saveLabelTexture = null;
        this._hoverCooldown = new WeakMap();
    }

    setupInteractions() {
        this.onMouseClick = this.onMouseClick.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
    }

    onMouseMove(event) {
        if (!this.isSaveMode) return;

        const rect = this.mainRenderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.mainCamera);
        const intersects = this.raycaster.intersectObjects(this.solidMeshes, true);
        
        if (intersects.length > 0) {
            let rootSolid = intersects[0].object;
            while (rootSolid.parent && !this.solidMeshes.includes(rootSolid)) {
                rootSolid = rootSolid.parent;
            }
            const solidIndex = this.solidMeshes.indexOf(rootSolid);
            if (solidIndex !== -1) {
                const cooldownUntil = this._hoverCooldown.get(rootSolid);
                if (cooldownUntil && performance.now() < cooldownUntil) return;
                if (cooldownUntil) this._hoverCooldown.delete(rootSolid);
                this.hoverSolid(rootSolid, solidIndex);
                return;
            }
        }

        // Clear hover when pointer is NOT over any solid
        this.clearHover();
    }

    onMouseClick(event) {
        if (!this.isSaveMode) return;

        // Calculate mouse position in normalized device coordinates
        const rect = this.mainRenderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Update the raycaster
        this.raycaster.setFromCamera(this.mouse, this.mainCamera);

        // Find intersections with solids
        const intersects = this.raycaster.intersectObjects(this.solidMeshes, true);
        
        if (intersects.length > 0) {
            const clickedObject = intersects[0].object;
            
            // Find the root solid (in case we clicked on a child mesh)
            let rootSolid = clickedObject;
            while (rootSolid.parent && !this.solidMeshes.includes(rootSolid)) {
                rootSolid = rootSolid.parent;
            }
            
            // If we found a valid solid, select it
            const solidIndex = this.solidMeshes.indexOf(rootSolid);
            if (solidIndex !== -1) {
                this.selectSolid(rootSolid, solidIndex);
            }
        }
    }

    hoverSolid(solid, index) {
        const cooldownUntil = this._hoverCooldown.get(solid);
        if (cooldownUntil && performance.now() < cooldownUntil) return;

        // Don't re-hover if already hovering this solid
        if (solid === this.hoveredSolid) return;
        
        // Clear previous hover
        if (this.hoveredSolid) {
            this.clearHover();
        }

        this.hoveredSolid = solid;
        this.hoveredSolidIndex = index;
        this.addHoverOutline(solid);
        this.mainRenderer.domElement.style.cursor = 'pointer';
    }

    addHoverOutline(solid) {
        const isSelected = this.selectedSolids.includes(solid);
        solid.traverse((child) => {
            if (!child.isMesh) return;

            if (!child.userData.__saveModeMaterialOriginal) {
                child.userData.__saveModeMaterialOriginal = child.material;
            }

            this._applySolidTint(child, isSelected ? 0.6 : 0.35);
        });
    }

    clearHover() {
        if (!this.hoveredSolid) return;
        
        const isSelected = this.selectedSolids.includes(this.hoveredSolid);
        
        if (!isSelected) {
            // Restore to original material from global cache
            this.hoveredSolid.traverse(child => {
                if (child.isMesh) {
                    const originalMaterial = this._globalMaterialCache.get(child);
                    if (originalMaterial) {
                        child.material = originalMaterial;
                    }
                    
                    if (child.element) {
                        child.element.classList.remove('hovered-solid', 'hovered-aura');
                    }
                }
            });
        } else {
            // Re-apply selection tint (without hover intensity)
            this.addSelectionOutline(this.hoveredSolid);
        }
        
        this.hoveredSolid = null;
        this.hoveredSolidIndex = -1;
        this.mainRenderer.domElement.style.cursor = 'default';
    }

    addSelectionOutline(solid) {
        solid.traverse((child) => {
            if (!child.isMesh) return;

            if (!child.userData.__saveModeMaterialOriginal) {
                child.userData.__saveModeMaterialOriginal = child.material;
            }

            this._applySolidTint(child, 0.65);
        });
    }

    selectSolid(solid, index) {
        // If already selected, deselect
        if (solid.userData.__saveModeSelected === true || this.selectedSolids.includes(solid)) {
            this.deselectSolid(solid, index);
            return;
        }

        solid.userData.__saveModeSelected = true;
        this.selectedSolids.push(solid);

        // CHANGED: Play with overlap allowed
        const id = solid?.userData?.solution?.id;
        if (id != null) {
            try {
                this.particleSystem?.surroundController?.playOneShot(id, { 
                    allowOverlap: true,  // CHANGED: Allow multiple sounds
                    highlightMesh: solid
                });
                this._saveModePlayingIds.add(id); // CHANGED: Add to Set
            } catch (e) {
                console.error('Failed to play audio on select:', e);
            }
        }

        this.addSelectionOutline(solid);

        if (!solid.userData.saveIconWorldPosition) {
            solid.userData.saveIconWorldPosition = this.getCameraFacingFaceCenter(solid);
        }

        this.createSaveToLibraryButton(solid, index);
        this.updateSaveCombinationButton();

        console.log(`Selected solid ${index}, playing: ${Array.from(this._saveModePlayingIds)}`);
    }

    getCameraFacingFaceCenter(solid) {
        // Get bounding box
        const box = new THREE.Box3().setFromObject(solid);
        const min = box.min;
        const max = box.max;
        
        // Get camera direction relative to the solid
        const solidWorldPosition = new THREE.Vector3();
        solid.getWorldPosition(solidWorldPosition);
        
        const cameraDirection = new THREE.Vector3();
        cameraDirection.subVectors(this.mainCamera.position, solidWorldPosition).normalize();
        
        // Define the 6 face centers and their normals
        const faces = [
            { center: new THREE.Vector3(max.x, (min.y + max.y) / 2, (min.z + max.z) / 2), normal: new THREE.Vector3(1, 0, 0) },   // Right face
            { center: new THREE.Vector3(min.x, (min.y + max.y) / 2, (min.z + max.z) / 2), normal: new THREE.Vector3(-1, 0, 0) },  // Left face
            { center: new THREE.Vector3((min.x + max.x) / 2, max.y, (min.z + max.z) / 2), normal: new THREE.Vector3(0, 1, 0) },   // Top face
            { center: new THREE.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2), normal: new THREE.Vector3(0, -1, 0) },  // Bottom face
            { center: new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, max.z), normal: new THREE.Vector3(0, 0, 1) },   // Front face
            { center: new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, min.z), normal: new THREE.Vector3(0, 0, -1) }   // Back face
        ];
        
        // Find the face that's most aligned with the camera direction
        let bestFace = faces[0];
        let bestDot = -Infinity;
        
        for (const face of faces) {
            // Calculate how much this face normal aligns with camera direction
            const dot = face.normal.dot(cameraDirection);
            if (dot > bestDot) {
                bestDot = dot;
                bestFace = face;
            }
        }
        
        console.log(`Camera-facing face center for solid:`, bestFace.center, `(normal: ${bestFace.normal.x}, ${bestFace.normal.y}, ${bestFace.normal.z})`);
        
        return bestFace.center.clone();
    }

   deselectSolid(solid, index) {
    this.selectedSolids = this.selectedSolids.filter(s => s !== solid);
    solid.userData.__saveModeSelected = false;
    
    // FIXED: Stop only THIS solid's audio
    const id = solid?.userData?.solution?.id;
    if (id != null) {
        this._saveModePlayingIds.delete(id);
        try {
            // Call the stop method with proper fade
            this.particleSystem?.surroundController?.stopOneShotById?.(id, 250);
            
            // ADDED: Explicitly clear the green outline from audio
            this.particleSystem?.surroundController?._unhighlightSource(id);
        } catch (e) {
            console.error('Failed to stop audio on deselect:', e);
        }
    }
    
    // ADDED: Block hover for longer time
    this._hoverCooldown.set(solid, performance.now() + 800);
    if (this.hoveredSolid === solid) {
        this.hoveredSolid = null;
        this.hoveredSolidIndex = -1;
    }
    this._restoreSolidMaterial(solid);

    // Remove UI elements
    if (solid.userData.saveToLibraryBtn) {
        solid.userData.saveToLibraryBtn.remove();
        solid.userData.saveToLibraryBtn = null;
    }
    if (solid.userData.save3DIcon) {
        this.particleSystem.scene.remove(solid.userData.save3DIcon);
        solid.userData.save3DIcon = null;
    }
    if (solid.userData.saveConnectionLine) {
        this.particleSystem.scene.remove(solid.userData.saveConnectionLine);
        solid.userData.saveConnectionLine.geometry.dispose();
        solid.userData.saveConnectionLine.material.dispose();
        solid.userData.saveConnectionLine = null;
    }
    if (solid.userData.saveLabelSprite) {
        solid.userData.saveLabelSprite = null;
    }

    this.updateSaveCombinationButton();
    
    console.log(`Deselected solid ${index}, still playing: ${Array.from(this._saveModePlayingIds)}`);
}

    createSaveToLibraryButton(solid, solidIndex) {
        // Remove any existing button for this solid
        if (solid.userData.saveToLibraryBtn) {
            solid.userData.saveToLibraryBtn.remove();
            solid.userData.saveToLibraryBtn = null;
        }
        
        // Remove any existing 3D icon
        if (solid.userData.save3DIcon) {
            this.particleSystem.scene.remove(solid.userData.save3DIcon);
            solid.userData.save3DIcon = null;
        }

        
        this.create3DSaveIcon(solid, solidIndex);

     
        this.createHTMLButton(solid, solidIndex);
    }

    saveToLibrary(solid, solidIndex) {
    console.log(`💾 Saving solid ${solidIndex} to library`);

    const solutionData = solid.userData.solution;
    const audioParams = solid.userData.audioParams;
    const descriptors = solid.userData.descriptors;
    const category = solid.userData.category;

    if (!solutionData || !audioParams) {
        console.warn('⚠️ No real solution data found for solid, using fallback');
        this.saveToLibraryWithFallback(solid, solidIndex);
        return;
    }

    // FIXED: Check if already exists with comprehensive criteria
    const testItem = {
        type: 'solution',
        solutionId: solutionData?.id,
        solutionData: solutionData,
        solid: solid
    };
    const existing = this.library.findExistingItem(testItem);
    
    if (existing) {
        this.showAlreadySavedMessage('solution', existing.name);
        return;
    }

    this.showNameInputWidget('solution', (name) => {
        const libraryItem = {
            id: solutionData?.id || Date.now(),
            name,
            type: 'solution',
            category: category || 'unknown',
            description: '',
            solid,
            solutionData,
            audioParams,
            descriptors
        };
        
        // Temporarily restore material for snapshot
        const swaps = [];
        solid.traverse(child => {
            if (child.isMesh) {
                const original = this._globalMaterialCache.get(child);
                if (original && child.material !== original) {
                    swaps.push({ child, temp: child.material });
                    child.material = original;
                }
            }
        });
        
        this.library.addItem(libraryItem);
        
        // Restore tinted materials
        swaps.forEach(({ child, temp }) => {
            child.material = temp;
        });
        
        // CHANGED: Use stylized message instead of alert
        this.showSuccessMessage(`Solution "${name}" saved to library!`);
        this.deselectSolid(solid, solidIndex);
    });
}


    // **NEW: Fallback method for solids without real data**
    saveToLibraryWithFallback(solid, solidIndex) {
        console.warn('⚠️ Using fallback dummy data for solid without real solution data');

        const fallbackId = solid.uuid;
        
        // FIXED: Check with comprehensive criteria
        const testItem = {
            type: 'solution',
            solutionId: fallbackId,
            id: fallbackId,
            solid: solid
        };
        const existing = this.library.findExistingItem(testItem);
        
        if (existing) {
            this.showAlreadySavedMessage('solution', existing.name);
            return;
        }

        this.showNameInputWidget('solution', (name) => {
            const audioParams = this.getFallbackAudioParams();
            const libraryItem = {
                id: fallbackId, // **FIX: Use solid.uuid as primary ID**
                solutionId: fallbackId, // **FIX: Also set solutionId explicitly**
                name,
                type: 'solution',
                category: audioParams.category || 'unknown',
                description: '',
                solid,
                solutionData: null, // No real solution data
                audioParams,
                descriptors: this.getFallbackDescriptors()
            };
            this.library.addItem(libraryItem);
            alert(`Solution "${name}" saved to library with fallback data!`);
            this.deselectSolid(solid, solidIndex);
        });
    }

    create3DSaveIcon(solid, solidIndex) {
        const iconGroup = new THREE.Group();
        
        // INCREASED SIZE: Larger icon
        const horizontalGeometry = new THREE.BoxGeometry(3.0, 0.3, 0.6); // Increased from 2.0, 0.15, 0.5
        const verticalGeometry = new THREE.BoxGeometry(0.3, 3.0, 0.6);   // Increased from 0.15, 2.0, 0.5
        
        // Glowing material
        const iconMaterial = new THREE.MeshStandardMaterial({
            color: 0x00ffaa,
            emissive: 0x00ffaa,
            emissiveIntensity: 1.2,
            transparent: true,
            opacity: 1.0,
            metalness: 0.3,
            roughness: 0.2
        });
        
        const horizontalBar = new THREE.Mesh(horizontalGeometry, iconMaterial);
        const verticalBar = new THREE.Mesh(verticalGeometry, iconMaterial);
        
        iconGroup.add(horizontalBar);
        iconGroup.add(verticalBar);
        
        // Get solid bounding box to find top center
        const box = new THREE.Box3().setFromObject(solid);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        
        // Position icon ABOVE the solid with extra height
        const heightAboveSolid = 8; // Height above the solid's top
        const topY = box.max.y + heightAboveSolid;
        
        // Use the center X and Z, but position at top
        const iconPosition = new THREE.Vector3(center.x, topY, center.z);
        iconGroup.position.copy(iconPosition);
        
        // Store for line connection
        solid.userData.saveIconWorldPosition = iconPosition;
        solid.userData.solidTopPosition = new THREE.Vector3(center.x, box.max.y, center.z);
        
        // Scale based on distance
        const distance = iconPosition.distanceTo(this.mainCamera.position);
        const minScale = 1.0;
        const maxScale = 1.5;
        const minDist = 10;
        const maxDist = 80;
        const scale = Math.max(minScale, Math.min(maxScale, maxScale - ((distance - minDist) / (maxDist - minDist)) * (maxScale - minScale)));
        iconGroup.scale.setScalar(scale);
        
        // Always face camera
        iconGroup.lookAt(this.mainCamera.position);
        
        // CREATE VERTICAL LINE from solid top to icon
        const lineGeometry = new THREE.BufferGeometry();
        const linePositions = new Float32Array([
            center.x, box.max.y, center.z,        // Start at solid top
            center.x, topY, center.z              // End at icon position
        ]);
        lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
        
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x00ffaa,              // Same color as icon
            transparent: true,
            opacity: 0,
            linewidth: 1
        });
        
        const connectionLine = new THREE.Line(lineGeometry, lineMaterial);
        connectionLine.layers.enable(1); // Enable bloom
        
        // Add line to scene
       /* this.particleSystem.scene.add(connectionLine);*/
        
        // Store line reference
        solid.userData.saveConnectionLine = connectionLine;
        
        // Animation with line update
        iconGroup.userData.animationOffset = Math.random() * Math.PI * 2;
        iconGroup.userData.baseY = topY;
        iconGroup.userData.update = (time) => {
            // Subtle floating animation
            const floatOffset = Math.sin(time * 2 + iconGroup.userData.animationOffset) * 0.15;
            iconGroup.position.y = iconGroup.userData.baseY + floatOffset;
            
            // Update line end position to follow icon
            const positions = connectionLine.geometry.attributes.position.array;
            positions[4] = iconGroup.position.y; // Update Y of second point (end of line)
            connectionLine.geometry.attributes.position.needsUpdate = true;
            
            // Gentle rotation
            iconGroup.rotation.z = Math.sin(time * 1.5 + iconGroup.userData.animationOffset) * 0.1;
            
            // Always face camera
            iconGroup.lookAt(this.mainCamera.position);
            
            // Subtle line opacity pulse
            connectionLine.material.opacity = 0.6 + Math.sin(time * 1.5) * 0.2;
        };
        
        // Enable bloom layer
        iconGroup.layers.enable(1);
        iconGroup.traverse(child => {
            if (child.isMesh) {
                child.layers.enable(1);
            }
        });
        
        // Add to scene
        this.particleSystem.scene.add(iconGroup);
        
        // Store reference
        solid.userData.save3DIcon = iconGroup;
        
        console.log(`Created 3D save icon with connection line for solid ${solidIndex}`);
        
        const label = this._createSaveLabelSprite();
        label.position.set(0, -2.8, 0);
        label.scale.set(6, 2.2, 1);
        label.renderOrder = 5;
        label.material.depthTest = false;
        iconGroup.add(label);
    }

    createHTMLButton(solid, solidIndex) {
        // Create invisible HTML button for click detection
        const saveBtn = document.createElement('button');
        saveBtn.className = 'save-to-library-btn-3d';
        saveBtn.setAttribute('data-solid-index', solidIndex);
        saveBtn.style.position = 'absolute';
        saveBtn.style.background = 'transparent';
        saveBtn.style.border = 'none';
        saveBtn.style.cursor = 'pointer';
        saveBtn.style.zIndex = '2000';
        saveBtn.style.borderRadius = '50%';
        
       
        const distance = solid.userData.saveIconWorldPosition.distanceTo(this.mainCamera.position);
        const minScale = 0.5;
        const maxScale = 1.0;
        const minDist = 10;
        const maxDist = 80;
        const scale = Math.max(minScale, Math.min(maxScale, maxScale - ((distance - minDist) / (maxDist - minDist)) * (maxScale - minScale)));
        
        // Base button size scaled by distance
        const baseSize = 60;
        const scaledSize = baseSize * scale;
        
        saveBtn.style.width = `${scaledSize}px`;
        saveBtn.style.height = `${scaledSize}px`;
        
        // Position button over the 3D icon
        this.updateHTMLButtonPosition(saveBtn, solid);
        
        document.body.appendChild(saveBtn);
        
        // Store reference
        solid.userData.saveToLibraryBtn = saveBtn;
        
        saveBtn.onclick = () => this.saveToLibrary(solid, solidIndex);
    }

    updateHTMLButtonPosition(button, solid) {
        if (!solid.userData.save3DIcon) return;
        
        // Project 3D icon position to screen space
        const iconPosition = solid.userData.save3DIcon.position.clone();
        const projected = iconPosition.project(this.mainCamera);
        
        const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
        const y = (projected.y * -0.5 + 0.5) * window.innerHeight;
        
       
        const buttonSize = parseFloat(button.style.width) || 60;
        const halfSize = buttonSize / 2;
        
        // Center the button on the projected position
        button.style.left = `${x - halfSize}px`;
        button.style.top = `${y - halfSize}px`;
    }

   
    update3DIconPositions() {
        if (!this.isSaveMode) return;
        
        const time = performance.now() * 0.001;
        
        this.selectedSolids.forEach(solid => {
            // Update 3D icon animation
            if (solid.userData.save3DIcon && solid.userData.save3DIcon.userData.update) {
                solid.userData.save3DIcon.userData.update(time);
            }
            
            // Update HTML button position
            if (solid.userData.saveToLibraryBtn) {
                this.updateHTMLButtonPosition(solid.userData.saveToLibraryBtn, solid);
            }
        });
    }

   


   saveCombination() {
    console.log(`💾 Saving combination of ${this.selectedSolids.length} solids`);

    const items = this.selectedSolids.map((solid, index) => {
        const solutionData = solid.userData.solution;
        const audioParams = solid.userData.audioParams;
        const descriptors = solid.userData.descriptors;
        const category = solid.userData.category;
        return {
            name: solutionData ? `${category || 'Unknown'} Sound ${index + 1}` : `Sound ${index + 1}`,
            solid,
            solutionData,
            audioParams: audioParams || this.getFallbackAudioParams(),
            descriptors: descriptors || this.getFallbackDescriptors(),
            category: category || 'unknown',
            fitness: solutionData?.fitness || 0,
            id: solutionData?.id || solid.uuid,
            solutionId: solutionData?.id || solid.uuid
        };
    });

    // FIXED: Check with proper criteria
    const testItem = {
        type: 'combination',
        items: items
    };
    const existing = this.library.findExistingItem(testItem);
    
    if (existing) {
        this.showAlreadySavedMessage('combination', existing.name);
        return;
    }

    this.showNameInputWidget('combination', (name) => {
        const categories = items.map(i => i.category).filter(Boolean);
        const avgFitness = items.reduce((s, it) => s + (it.fitness || 0), 0) / Math.max(1, items.length);
        const uniqueCategories = [...new Set(categories)];

        const libraryItem = {
            id: Date.now(),
            name,
            type: 'combination',
            description: '', 
            items,
            solid: this.selectedSolids[Math.floor(Math.random() * this.selectedSolids.length)]
        };

        this.library.addItem(libraryItem);
        
        // CHANGED: Use stylized message instead of alert
        this.showSuccessMessage(`Combination "${name}" saved to library!`);
        this.clearAllSelections();
    });
}

// NEW: Show stylized success message
showSuccessMessage(text) {
    // Create or reuse message element
    let messageEl = document.getElementById('save-mode-message');
    if (!messageEl) {
        messageEl = document.createElement('div');
        messageEl.id = 'save-mode-message';
        messageEl.className = 'submission-message success';
        document.body.appendChild(messageEl);
    }
    
    messageEl.textContent = text;
    messageEl.classList.remove('error');
    messageEl.classList.add('success', 'visible');
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        messageEl.classList.remove('visible');
    }, 3000);
}

// NEW: Show stylized error message
showErrorMessage(text) {
    // Create or reuse message element
    let messageEl = document.getElementById('save-mode-message');
    if (!messageEl) {
        messageEl = document.createElement('div');
        messageEl.id = 'save-mode-message';
        messageEl.className = 'submission-message error';
        document.body.appendChild(messageEl);
    }
    
    messageEl.textContent = text;
    messageEl.classList.remove('success');
    messageEl.classList.add('error', 'visible');
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        messageEl.classList.remove('visible');
    }, 3000);
}
    showNameInputWidget(type, onSave) {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'name-input-overlay';

        // Create widget
        const widget = document.createElement('div');
        widget.className = 'name-input-widget';

        // Create title
        const title = document.createElement('h3');
        title.textContent = `Name your ${type}`;
        widget.appendChild(title);

        // Create input
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = `Enter ${type} name...`;
        input.value = `My ${type} ${Date.now()}`;
        widget.appendChild(input);

        // Create buttons container
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'name-input-buttons';

        // Create save button with icon
        const saveBtn = document.createElement('button');
        saveBtn.className = 'name-input-btn save';
        saveBtn.title = 'Save';
        saveBtn.innerHTML = '<img src="/assets/icons/Confirm.svg" alt="Save" class="name-input-icon">';
        saveBtn.onclick = () => {
            const name = input.value.trim();
            if (name) {
                onSave(name);
                overlay.remove();
            } else {
                input.focus();
                input.style.borderColor = '#dc3545';
            }
        };

        // Create cancel button with icon
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'name-input-btn cancel';
        cancelBtn.title = 'Cancel';
        cancelBtn.innerHTML = '<img src="/assets/icons/Cancel.svg" alt="Cancel" class="name-input-icon">';
        cancelBtn.onclick = () => {
            overlay.remove();
        };

        buttonsContainer.appendChild(saveBtn);
        buttonsContainer.appendChild(cancelBtn);
        widget.appendChild(buttonsContainer);

        overlay.appendChild(widget);
        document.body.appendChild(overlay);

        // Auto-focus input
        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);

        // NEW: Stop propagation of ALL keyboard events from input
        input.addEventListener('keydown', (e) => {
            e.stopPropagation(); // Prevent event from bubbling up
            e.stopImmediatePropagation(); // Stop other handlers on same element
            
            if (e.key === 'Enter') {
                e.preventDefault();
                saveBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelBtn.click();
            }
        });

        // NEW: Also stop keyup and keypress events
        input.addEventListener('keyup', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
        });
        
        input.addEventListener('keypress', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
        });

        // Click overlay to close
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });
    }

    
    updateSaveCombinationButton() {
        // Remove if exists
        if (this.saveCombinationBtn) {
            this.saveCombinationBtn.remove();
            this.saveCombinationBtn = null;
        }
        
       
        if (this.selectedSolids.length > 1) {
            this.saveCombinationBtn = document.createElement('button');
            this.saveCombinationBtn.className = 'save-combination-btn';
            this.saveCombinationBtn.innerText = 'Save Combination';
           
        
            document.body.appendChild(this.saveCombinationBtn);

            this.saveCombinationBtn.onclick = () => this.saveCombination();
        }
    }

    
    clearSelection() {
        this.selectedSolids.forEach(solid => {
            solid.userData.__saveModeSelected = false;
            // If any selected solid owns the currently playing id, silence it
            const id = solid?.userData?.solution?.id;
            if (id != null && this._saveModePlayingId === id) {
                try { this.particleSystem?.surroundController?.fadeOutAll(120); } catch {}
                this._saveModePlayingId = null;
            }
            solid.traverse((child) => {
                if (child.isMesh) {
                    // Always restore the true original material
                    if (child.userData.originalMaterial) {
                        child.material = child.userData.originalMaterial;
                        delete child.userData.originalMaterial;
                    }
                    // Remove any leftover hover material reference
                    if (child.userData.originalHoverMaterial) {
                        delete child.userData.originalHoverMaterial;
                    }
                }
                if (child.element) {
                    child.element.classList.remove('selected-solid');
                    child.element.classList.remove('hovered-solid');
                    child.element.classList.remove('hovered-aura');
                }
            });

            // Remove this solid's HTML button
            if (solid.userData.saveToLibraryBtn) {
                solid.userData.saveToLibraryBtn.remove();
                solid.userData.saveToLibraryBtn = null;
            }
            
            // Remove 3D icon
            if (solid.userData.save3DIcon) {
                this.particleSystem.scene.remove(solid.userData.save3DIcon);
                solid.userData.save3DIcon = null;
            }
            
            // **NEW: Remove connection line**
            if (solid.userData.saveConnectionLine) {
                this.particleSystem.scene.remove(solid.userData.saveConnectionLine);
                solid.userData.saveConnectionLine.geometry.dispose();
                solid.userData.saveConnectionLine.material.dispose();
                solid.userData.saveConnectionLine = null;
            }
        });

        // Ensure nothing continues playing
        try { this.particleSystem?.surroundController?.fadeOutAll(120); } catch {}
        this._saveModePlayingId = null;
    }


  


 
    clearAllSelections({ restoreMaterials = true } = {}) {
        [...this.selectedSolids].forEach(solid => {
            const index = this.solidMeshes.indexOf(solid);
            const id = solid?.userData?.solution?.id;
            
            // CHANGED: Stop each sound individually
            if (id != null && this._saveModePlayingIds.has(id)) {
                this._saveModePlayingIds.delete(id);
                try {
                    this.particleSystem?.surroundController?.stopOneShotById?.(id, 250);
                } catch {}
            }
            
            this.deselectSolid(solid, index);
        });

        if (this.saveCombinationBtn) {
            this.saveCombinationBtn.remove();
            this.saveCombinationBtn = null;
        }

        if (restoreMaterials) {
            this._forceCleanupAllMaterials(false);
        }
    }

    showAlreadySavedMessage(type, existingName) {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'name-input-overlay';

        // Create widget
        const widget = document.createElement('div');
        widget.className = 'name-input-widget';

        // Create title
        const title = document.createElement('h3');
        title.textContent = `${type.charAt(0).toUpperCase() + type.slice(1)} Already Saved`;
        widget.appendChild(title);

        // Create message
        const message = document.createElement('p');
        message.innerHTML = `This ${type} is already in your library as:<br><strong>"${existingName}"</strong>`; // CHANGED: Removed inline styles
        widget.appendChild(message);

        // Create buttons container
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'name-input-buttons';

        // Create OK button
        const okBtn = document.createElement('button');
        okBtn.className = 'name-input-btn save';
        okBtn.textContent = 'OK';
        okBtn.onclick = () => {
            overlay.remove();
        };

        buttonsContainer.appendChild(okBtn);
        widget.appendChild(buttonsContainer);

        overlay.appendChild(widget);
        document.body.appendChild(overlay);

        // Auto-focus OK button
        setTimeout(() => okBtn.focus(), 100);

        // Allow ESC and Enter to close
        const handleKey = (e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', handleKey);
            }
        };
        document.addEventListener('keydown', handleKey);

        // Click overlay to close
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                document.removeEventListener('keydown', handleKey);
            }
        });
    }

    // CHANGE 1: Fix material caching to NOT clone (use reference instead)
    _cacheOriginalMaterials() {
        if (this._baseMaterialsCached) return;

        console.log('📦 Caching original materials');
        
        this.solidMeshes.forEach(solid => {
            solid.traverse(child => {
                if (!child.isMesh) return;
                
                // CRITICAL: Cache the CURRENT material as the true original
                // (This should be the untinted material from main scene)
                if (!child.userData.__saveModeOriginalMaterial) {
                    child.userData.__saveModeOriginalMaterial = child.material;
                    child.userData.__saveModeBaseMaterial = this._cloneMaterial(child.material);
                }
            });
        });

        this._baseMaterialsCached = true;
        console.log('✅ Original materials cached');
    }

    // CHANGE 2: Fix material restoration to use reference, not clone
    _restoreSolidMaterial(solid) {
    if (!solid) return;

    solid.traverse(child => {
        if (!child.isMesh) return;

        // Always restore from global cache
        const originalMaterial = this._globalMaterialCache.get(child);
        if (originalMaterial) {
            child.material = originalMaterial;
        }

        if (child.element) {
            child.element.classList.remove('selected-solid', 'hovered-solid', 'hovered-aura');
        }
    });
}

    // CHANGE 3: Fix force cleanup to use reference
    _forceCleanupAllMaterials(removeCache = false) {
        console.log('🧹 Force cleaning all materials');
    
        this.solidMeshes.forEach(solid => {
            if (!solid) return;
            
            solid.traverse(child => {
                if (!child.isMesh) return;

                // CRITICAL: Always restore to the ORIGINAL material we cached on enter
                const originalMaterial = child.userData.__saveModeOriginalMaterial;
                if (originalMaterial) {
                    child.material = originalMaterial;
                }

                // Clean up CSS classes
                if (child.element) {
                    child.element.classList.remove('selected-solid', 'hovered-solid', 'hovered-aura');
                }

                // Delete ALL temporary material references
                delete child.userData.__saveModeMaterialTint;
                delete child.userData.__saveModeMaterialOriginal;

                if (removeCache) {
                    delete child.userData.__saveModeBaseMaterial;
                    delete child.userData.__saveModeOriginalMaterial;
                }
            });
            
            // Clean up solid-level flags
            delete solid.userData.__saveModeSelected;
        });
        
        console.log('✅ All materials restored to original state');
    }

    _createSaveLabelSprite() {
        if (!this._saveLabelTexture) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = '600 58px "Space Grotesk", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('SAVE', canvas.width / 2, canvas.height / 2);

            this._saveLabelTexture = new THREE.CanvasTexture(canvas);
            this._saveLabelTexture.minFilter = THREE.LinearFilter;
            this._saveLabelTexture.magFilter = THREE.LinearFilter;
            this._saveLabelTexture.needsUpdate = true;
        }

        return new THREE.Sprite(new THREE.SpriteMaterial({
            map: this._saveLabelTexture,
            transparent: true,
            depthWrite: false,
            depthTest: false
        }));
    }

    _applySolidTint(child, intensity = 0.5) {
        if (!child.isMesh) return;
        
        const originalMaterial = this._globalMaterialCache.get(child);
        if (!originalMaterial) {
            console.warn('⚠️ No cached material for mesh');
            return;
        }
        
        // Clone the ORIGINAL and tint it
        const tinted = this._createTintedMaterial(originalMaterial, intensity);
        child.material = tinted;
    }

    _createTintedMaterial(source, intensity) {
        if (!source || typeof source.clone !== 'function') return source;
        
        const cloned = source.clone();
        const aura = new THREE.Color(0x53d3c0);

        if ('emissive' in cloned) {
            cloned.emissive = aura.clone();
            cloned.emissiveIntensity = Math.max(intensity, cloned.emissiveIntensity ?? 0);
        }
        if ('color' in cloned) {
            cloned.color = cloned.color.clone().lerp(aura, 0.45);
        }
        cloned.transparent = true;
        cloned.opacity = Math.min(0.95, source.opacity ?? 1);
        cloned.needsUpdate = true;
        
        return cloned;
    }

    forceReset({ restoreMaterials = true } = {}) {
        this.clearHover();
        this.clearAllSelections({ restoreMaterials: false }); // Don't double-restore
        if (restoreMaterials) {
            this._restoreAllFromGlobalCache();
        }
        this._hoverCooldown = new WeakMap();
        this.selectedSolids = [];
    }

    // NEW: Restore ALL materials from the global cache
    _restoreAllFromGlobalCache() {
        console.log('🔄 Restoring all materials from global cache');
        
        this.solidMeshes.forEach(solid => {
            solid.traverse(child => {
                if (child.isMesh) {
                    const originalMaterial = this._globalMaterialCache.get(child);
                    if (originalMaterial) {
                        child.material = originalMaterial;
                    }
                    
                    // Clean up ALL temporary userData
                    delete child.userData.__saveModeMaterialTint;
                    delete child.userData.__saveModeMaterialOriginal;
                    delete child.userData.__saveModeBaseMaterial;
                    delete child.userData.__saveModeOriginalMaterial;
                    delete child.userData.__surroundPlayOriginal;
                    delete child.userData.__surroundOriginalMaterial;
                    
                    // Clean up CSS classes
                    if (child.element) {
                        child.element.classList.remove('selected-solid', 'hovered-solid', 'hovered-aura');
                    }
                }
            });
            
            delete solid.userData.__saveModeSelected;
        });
    }
}