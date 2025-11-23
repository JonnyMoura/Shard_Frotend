import * as THREE from 'three';
import { Button } from './Button.js';

export class Library {
    constructor(particleSystem, scene, camera, renderer, controls) {
        this.particleSystem = particleSystem;
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.controls = controls;

        // Saved items here: { id, type: 'solution'|'combination', name, description, category, items?, meshSnapshot:Object3D }
        this.libraryData = [];

        // Space mode state
        this.inSpace = false;
        this.group = new THREE.Group();
        this.group.name = 'LibraryGroup';
        this.cols = 6;             // default columns for grid
        this.spacingX = 20;        // horizontal spacing
        this.spacingZ = 22;        // depth spacing
        this.baseY = 0;            // center Y for all items
        this.snapScale = 1.0;      // global snapshot scale factor
        this._camRestore = null;

        // Picking
        this._raycaster = new THREE.Raycaster();
        this._pointer = new THREE.Vector2();
        this._onPointerDown = this._handlePointerDown.bind(this);
        this._onPointerMove = this._handlePointerMove.bind(this);
        this._onPointerLeave = this._handlePointerLeave.bind(this);

        // Info panel near selected mesh
        this._panel = this._createInfoPanel();
        this._lastPanelMesh = null;
        this.selectedItem = null;

        // Hover/selection state
        this._hoveredContainer = null;   
        this._selectedContainer = null; 

        this._isEditingName = false;
        this._isEditingDesc = false;

        // NEW: Global material cache for library items (like SaveMode)
        this._globalLibraryMaterialCache = new WeakMap();

        // UI entry point
        this.createLibraryButton();
        this.createCloseButton(); // NEW: Add close button

        window.addEventListener('resize', () => {
            if (this.inSpace) this._positionInfoPanel();
        });

        // Library swarms (grains) runtime
        this._libItems = []; // [{ container, solid, grains:[], params:{ baseRadius, baseY, topY } }]
        this.libraryGrainsPerSolid = (particleSystem?.grainsPerVisiblePeak ?? 300);
        this.libraryBaseRadius = (particleSystem?.baseRadius ?? 2);
        this.libraryGrainColumnHeight = (particleSystem?.grainColumnHeight ?? 6.0);
        this.libraryGrainClearance = (particleSystem?.defaultGrainClearance ?? 1.0);

        // Track hidden main-scene objects while in space
        this._hiddenMainGrains = [];
        this._hiddenMainSolids = [];

        this._pointerOverPanel = false;
        this._panelEditDepth = 0;

        this.nameMaxLength = 60;
        this.descriptionMaxLength = 200;
        this.nameVerticalThreshold = 18;

        // Track playing audio in library
        this._playingIds = new Set();
        this._playingMeshes = new Map(); // Map<id, mesh> for highlighting
    }

    // Public: toggle
    toggleLibrarySpace() {
        if (this.inSpace) this.exitSpace();
        else this.enterSpace();
    }

    enterSpace() {
        if (this.inSpace || !this.scene || !this.camera || !this.renderer) return;
        this.inSpace = true;

        // Change button text and set selected state
        this.libraryBtn.setSelected(true);
        // Fade out main scene sounds and stop sequencing
        try {
            this.particleSystem?.surroundController?.startMode(500);
        } catch {}

        // Hide main solids
        try {
            const solids = this.particleSystem.getSolids ? this.particleSystem.getSolids() : [];
            solids.forEach(m => {
                this._hiddenMainSolids.push({ mesh: m, prev: m.visible });
                m.visible = false;
            });
        } catch (e) {}

        // Hide main grains
        try {
            if (this.particleSystem?.peaks) {
                this.particleSystem.peaks.forEach(peak => {
                    if (!peak?.grains) return;
                    peak.grains.forEach(g => {
                        if (!g) return;
                        this._hiddenMainGrains.push({ grain: g, prev: g.visible });
                        g.visible = false;
                    });
                });
            }
        } catch (e) {}

        // Build grid content
        if (!this.group.parent) this.scene.add(this.group);
        this._buildGridFromLibraryData();

        this._camRestore = {
            pos: this.camera.position.clone(),
            target: this.controls ? this.controls.target.clone() : new THREE.Vector3(0, 0, 0)
        };
        this._animateCameraTopDown();

        // Enable picking + hover
        this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
        this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
        this.renderer.domElement.addEventListener('mouseleave', this._onPointerLeave);

        // Hide any existing panel until user picks
        this._hideInfoPanel();
        this._lastPanelMesh = null;
        this.selectedItem = null;

        // NEW: Show close button
        if (this.closeBtn) {
            this.closeBtn.style.display = 'block';
        }
    }

    exitSpace() {
        if (!this.inSpace) return;
        this.inSpace = false;

        // Change button text back and remove selected state
        this.libraryBtn.setSelected(false);
        
        // Stop all playing library sounds before exiting
        this._stopAllLibrarySounds();

        // Resume main scene sequential soundscape
        try {
            this.particleSystem?.surroundController?.resumeMainMode(5);
        } catch {}

        // Remove library group
        if (this.group.parent) this.scene.remove(this.group);

        // Restore main solids visibility
        try {
            this._hiddenMainSolids.forEach(({ mesh, prev }) => { if (mesh) mesh.visible = prev; });
            this._hiddenMainSolids = [];
        } catch (e) {}

        // Restore grains visibility
        try {
            this._hiddenMainGrains.forEach(({ grain, prev }) => { if (grain) grain.visible = prev; });
            this._hiddenMainGrains = [];
        } catch (e) {}

        // Restore camera
        if (this._camRestore) {
            this._animateCameraTo(this._camRestore.pos, this._camRestore.target, 800);
            this._camRestore = null;
        }

        // Disable picking/hover and panel
        this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
        this.renderer.domElement.removeEventListener('pointermove', this._onPointerMove);
        this.renderer.domElement.removeEventListener('mouseleave', this._onPointerLeave);

        // NEW: Hide close button
        if (this.closeBtn) {
            this.closeBtn.style.display = 'none';
        }
        
        this._clearHoverOutline();
        this._clearSelectionOutline();
        this._hideInfoPanel();
        this._lastPanelMesh = null;
        this.selectedItem = null;
    }

    // Call from your main animate loop
    update() {
        if (!this.inSpace) return;
        this._updateLibrarySolidsAnimation(); 
        this._updateLibraryGrains();
    }

    addItem(item) {
        // FIXED: Create unique ID that includes generation number to prevent collisions
        let normalizedSolutionId = null;
        if (item.type === 'solution') {
            const baseId = 
                item.solutionData?.id || 
                item.solutionId || 
                item.id || 
                (item.solid ? item.solid.uuid : null);
            
            const generation = 
                item.solutionData?.generation || 
                item.generation || 
                0;
            
            // Create unique ID: "gen_<generation>_sol_<id>"
            normalizedSolutionId = `gen_${generation}_sol_${baseId}`;
        }

        // Extract category from multiple sources with priority
        let categoryValue = '';
        if (item.type === 'solution') {
            categoryValue = 
                item.category || 
                (item.solid?.userData?.category) || 
                (item.solutionData?.actual_category) || 
                (item.audioParams?.category) ||
                '';
        } else if (item.type === 'combination') {
            categoryValue = item.category || '';
        }

        const record = {
            id: item.id || Date.now(),
            type: item.type || 'solution',
            name: item.name || '(unnamed)',
            description: item.description || '',
            category: categoryValue ? String(categoryValue).toLowerCase() : '',
            items: Array.isArray(item.items) ? item.items : undefined,
            meshSnapshot: null,
            solutionId: normalizedSolutionId,
            solutionData: item.solutionData || null,
            generation: item.generation || item.solutionData?.generation || 0 // ADDED: Store generation
        };

        let sourceMesh = null;
        if (record.type === 'solution') {
            sourceMesh = item.solid || null;
        } else if (record.type === 'combination' && Array.isArray(item.items) && item.items.length) {
            const pick = item.items[Math.floor(Math.random() * item.items.length)];
            sourceMesh = pick?.solid || item.solid || null;
        }

        if (sourceMesh) {
            const materialsSnapshot = item.materialsSnapshot || this._captureMaterialsFromSolid(sourceMesh);
            record.meshSnapshot = this._cloneSolid(sourceMesh, materialsSnapshot);
        }

        this.libraryData.push(record);

        // Live update grid if in space
        if (this.inSpace) this._buildGridFromLibraryData();
    }

    findExistingItem(criteria) {
        if (!criteria) return null;

        // FIXED: Search by unique solution ID (with generation)
        if (criteria.solutionId !== undefined || criteria.solutionData?.id !== undefined) {
            const baseId = criteria.solutionData?.id ?? criteria.solutionId;
            const generation = criteria.generation ?? criteria.solutionData?.generation ?? 0;
            const uniqueId = `gen_${generation}_sol_${baseId}`;
            
            const found = this.libraryData.find(item => {
                if (item.type === 'solution') {
                    return item.solutionId === uniqueId ||
                           item.solutionId === baseId || // Fallback for old saves
                           item.solutionData?.id === baseId;
                }
                return false;
            });
            if (found) return found;
        }

        // Search by combination items (compare all IDs with generation)
        if (criteria.type === 'combination' && Array.isArray(criteria.items)) {
            const searchIds = criteria.items
                .map(it => {
                    const baseId = it.solutionData?.id ?? it.solutionId ?? it.id;
                    const gen = it.generation ?? it.solutionData?.generation ?? 0;
                    return `gen_${gen}_sol_${baseId}`;
                })
                .filter(Boolean)
                .sort();

            const found = this.libraryData.find(item => {
                if (item.type !== 'combination' || !Array.isArray(item.items)) return false;
                
                const itemIds = item.items
                    .map(it => {
                        const baseId = it.solutionData?.id ?? it.solutionId ?? it.id;
                        const gen = it.generation ?? it.solutionData?.generation ?? 0;
                        return `gen_${gen}_sol_${baseId}`;
                    })
                    .filter(Boolean)
                    .sort();

                if (itemIds.length !== searchIds.length) return false;
                return searchIds.every((id, idx) => id === itemIds[idx]);
            });
            if (found) return found;
        }

        // Search by name (fallback)
        if (criteria.name) {
            return this.libraryData.find(item => 
                item.name.toLowerCase() === criteria.name.toLowerCase()
            );
        }

        return null;
    }

    // ============== grid building ==============

    _buildGridFromLibraryData() {
        // Clear current group
        while (this.group.children.length) this.group.remove(this.group.children[0]);
        this._libItems = [];
        
        // NEW: Clear material cache for fresh start
        this._globalLibraryMaterialCache = new WeakMap();

        const items = this.libraryData;
        if (!items.length) return;

        const cols = Math.max(2, Math.min(this.cols, Math.ceil(Math.sqrt(items.length))));
        const spacingX = this.spacingX;
        const spacingZ = this.spacingZ;

        items.forEach((item, idx) => {
            const snap = item.meshSnapshot ? item.meshSnapshot.clone(true) : null;
            if (!snap) return;

            snap.traverse(ch => { if (ch.isMesh) ch.matrixAutoUpdate = true; });
            snap.updateMatrixWorld(true);
            
            // NEW: Cache original materials immediately after cloning
            snap.traverse(child => {
                if (child.isMesh && !this._globalLibraryMaterialCache.has(child)) {
                    this._globalLibraryMaterialCache.set(child, child.material);
                }
            });

            const primary = this._findPrimaryMesh(snap) || snap;
            primary.updateMatrixWorld(true);

            const pBox = new THREE.Box3().setFromObject(primary);
            const pSize = pBox.getSize(new THREE.Vector3());
            const pCenter = pBox.getCenter(new THREE.Vector3());
            const pBottom = pCenter.y - pSize.y * 0.5;

            // Wrap into a container; center horizontally using PRIMARY center
            const container = new THREE.Group();
            container.name = `LibraryItem_${item.id}`;

            snap.position.x -= pCenter.x;
            snap.position.z -= pCenter.z;

            // Desired bottom of primary above grains
            const baseY = this.baseY;
            const topY = baseY + this.libraryGrainColumnHeight;
            const desiredBottom = topY + this.libraryGrainClearance;

            const deltaY = desiredBottom - pBottom;
            snap.position.y += deltaY;

            // Place container on the grid
            const r = Math.floor(idx / cols);
            const c = idx % cols;
            container.position.set(
                (c - (cols - 1) / 2) * spacingX,
                0,
                r * spacingZ
            );

            // Tag and add
            container.userData.__libraryItem = item;
            container.userData.__libraryIsSnapshot = true;
            container.userData.__solidRoot = snap;

            container.add(snap);
            this.group.add(container);

            // Build runtime for grains and animation
            const runtime = {
                container,
                solid: snap,
                primary: this._findPrimaryMesh(snap),
                orbitClones: [],
                grains: [],
                params: {
                    baseY,
                    topY,
                    baseRadius: this.libraryBaseRadius
                }
            };

            if (runtime.primary) {
                const primaryPos = new THREE.Vector3();
                runtime.primary.getWorldPosition(primaryPos);

                snap.traverse(n => {
                    if (n.isMesh && n !== runtime.primary && n.userData && n.userData.orbitAngle !== undefined) {
                        const clonePos = new THREE.Vector3();
                        n.getWorldPosition(clonePos);
                        const radius = Math.hypot(clonePos.x - primaryPos.x, clonePos.z - primaryPos.z);
                        n.userData._libOrbitRadius = radius;
                        n.userData._libHeightOffset = n.position.y - runtime.primary.position.y;
                        runtime.orbitClones.push(n);
                    }
                });
            }

            // Rebind/update animation functions for this clone tree
            this._retargetUpdateFunctionsForClone(runtime);

            // Create grains centered exactly under container
            this._createLibraryGrainsForItem(runtime);
            this._libItems.push(runtime);
        });

        this.group.position.set(0, 0, -20);
    }

    _createLibraryGrainsForItem(runtime) {
        const { container, params } = runtime;
        const count = this.libraryGrainsPerSolid;
        const minRadius = 0.8 * params.baseRadius;
        const maxRadius = params.baseRadius * 2.5;

        const sharedGeom = new THREE.SphereGeometry(0.09, 8, 8);
        const makeMaterial = () => new THREE.MeshStandardMaterial({
            color: 0xe0dbc1,
            emissive: 0xe0dbc1,
            emissiveIntensity: 0.3,
            transparent: true,
            opacity: 0.8
        });

        for (let j = 0; j < count; j++) {
            const mat = makeMaterial();
            const grain = new THREE.Mesh(sharedGeom, mat);
            grain.layers.enable(1);

            const heightFactor = Math.random();
            const angle = Math.random() * Math.PI * 2;
            const randomization = [];
            for (let r = 0; r < 4; r++) randomization.push(0.3 + 0.4 * Math.random());

            const baseAccel = 0.08 + 0.10 * Math.random();
            const baseSpeed = 0.025 + 0.050 * Math.random();
            const maxSpeed = 0.05 + 0.18 * Math.random();

            const baseRad = minRadius + (1 - heightFactor) * (maxRadius - minRadius);
            const cx = container.position.x;
            const cz = container.position.z;

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

            // Initial placement within the column range
            const initialY = params.baseY + heightFactor * (params.topY - params.baseY);
            grain.position.set(
                cx + baseRad * Math.cos(angle),
                Math.max(0.1, initialY),
                cz + baseRad * Math.sin(angle)
            );

            this.group.add(grain);
            runtime.grains.push(grain);
        }
    }

    _updateLibraryGrains() {
        const t = performance.now() * 0.001;

        for (let k = 0; k < this._libItems.length; k++) {
            const runtime = this._libItems[k];
            const { container, solid, grains, params } = runtime;
            if (!container || !solid || !grains || !grains.length) continue;

            // Recompute topY from solid's current transform to stay precise
            const { topY } = this._computeSolidGrainTopY(solid, params.baseY);
            params.topY = topY;

            const cx = container.position.x;
            const cz = container.position.z;

            for (let j = 0; j < grains.length; j++) {
                const grain = grains[j];
                if (!grain || !grain.userData) continue;

                const { heightFactor, angle, randomization } = grain.userData;

                const minRadius = 0.8 * params.baseRadius;
                const maxRadius = params.baseRadius * 2.5;
                const baseRadius = minRadius + (1 - heightFactor) * (maxRadius - minRadius);

                const wanderAngle = angle
                    + Math.sin(t * (0.15 + 0.4 * randomization[0]) + j) * 2.5
                    + Math.cos(t * (0.2 + 0.3 * randomization[1]) + j * 0.5) * 1.8;

                const wanderRadius = baseRadius
                    + Math.sin(t * (0.12 + 0.2 * randomization[2]) + j * 0.3) * 0.4
                    + Math.cos(t * (0.1 + 0.25 * randomization[3]) + j * 0.25) * 0.5;

                const range = Math.max(0.1, params.topY - params.baseY);
                const noise = (
                    Math.sin(t * (0.18 + 0.25 * randomization[1]) + j * 0.2) * 0.12 +
                    Math.cos(t * (0.22 + 0.15 * randomization[2]) + j * 0.15) * 0.08
                ) * range * 0.2;

                let wanderHeight = params.baseY + heightFactor * range + noise;
                if (wanderHeight > params.topY) wanderHeight = params.topY - 0.02;
                if (wanderHeight < params.baseY) wanderHeight = params.baseY + 0.02;

                const vagueTarget = new THREE.Vector3(
                    cx + wanderRadius * Math.cos(wanderAngle),
                    Math.max(0.1, wanderHeight),
                    cz + wanderRadius * Math.sin(wanderAngle)
                );

                if (!grain.userData.velocity) grain.userData.velocity = new THREE.Vector3();
                if (!grain.userData.acceleration) grain.userData.acceleration = new THREE.Vector3();

                const toVague = new THREE.Vector3().subVectors(vagueTarget, grain.position);
                const springStrength = grain.userData.baseAccel * 0.12;
                grain.userData.acceleration.copy(toVague).multiplyScalar(springStrength);

                const fromCenter = new THREE.Vector3(grain.position.x - cx, 0, grain.position.z - cz);
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
        }
    }

    _computeSolidGrainTopY(solid, baseY) {
        // Use primary mesh bounds (ignore orbiting clones)
        const primary = this._findPrimaryMesh(solid) || solid;
        primary.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(primary);
        const size = bb.getSize(new THREE.Vector3());
        const center = bb.getCenter(new THREE.Vector3());

        const clearance = size.y * 0.5 + this.libraryGrainClearance;

        const centerOffsetY = center.y - solid.position.y;
        const centerY = solid.position.y + centerOffsetY;
        const topY = centerY - clearance;

        return { topY: Math.max(baseY + 0.25, topY) };
    }

    // ============== Camera animation ==============

    _animateCameraTopDown() {
        const items = this.libraryData;
        const cols = Math.max(2, Math.min(this.cols, Math.ceil(Math.sqrt(items.length || 1))));
        const rows = Math.max(1, Math.ceil(items.length / cols));
        const gridWidth = (cols - 1) * this.spacingX;
        const gridDepth = Math.max(1, rows - 1) * this.spacingZ;

        // Center of the grid
        const center = new THREE.Vector3(0, 0, (rows - 1) * this.spacingZ * 0.5 - 20);

        const distance = Math.max(30, Math.max(gridWidth, gridDepth)) * 2.0; 
        const height = distance * 1.2; 
        const xOff = 0;                
        const zOff = distance;         

        const pos = new THREE.Vector3(center.x + xOff, height, center.z + zOff);

        // Look at the center of the grid
        this._animateCameraTo(pos, center, 800);
    }

    _animateCameraTo(pos, lookAt, duration = 800) {
        const startPos = this.camera.position.clone();
        const startTarget = this.controls ? this.controls.target.clone() : new THREE.Vector3();
        const start = performance.now();

        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const ease = 0.5 - 0.5 * Math.cos(Math.PI * t);
            this.camera.position.lerpVectors(startPos, pos, ease);
            if (this.controls) {
                const tgt = new THREE.Vector3().lerpVectors(startTarget, lookAt, ease);
                this.controls.target.copy(tgt);
                this.controls.update();
            } else {
                this.camera.lookAt(lookAt);
            }
            if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    _animateCameraToItem(container) {
        if (!container) return;
        
        // Get the world position and bounds of the selected item
        const box = new THREE.Box3().setFromObject(container);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        // Calculate camera position to show item on LEFT side of screen
        const maxDim = Math.max(size.x, size.y, size.z);
        const distance = maxDim * 3.5;
        
        // Position camera to show solid on left 40% of screen
        const cameraPos = new THREE.Vector3(
            center.x + distance * 0.7,  // Offset right so object appears left
            center.y + distance * 0.4,  // Elevated view
            center.z + distance * 0.8   // Pull back
        );
        
        // Animate camera smoothly
        this._animateCameraTo(cameraPos, center, 600);
    }

    // ============== UI ==============

    createLibraryButton() {
        this.libraryBtn = new Button('LIBRARY', 'hamburger', () => {});
    }

    // NEW: Create close button
    createCloseButton() {
        this.closeBtn = document.createElement('button');
        this.closeBtn.className = 'mode-close-btn library-mode-close';
        this.closeBtn.innerHTML = '×';
        this.closeBtn.title = 'Exit Library';
        this.closeBtn.style.display = 'none';
        
        this.closeBtn.onclick = (event) => {
            if (this.closeBtn.disabled) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (this.inSpace) {
                this.exitSpace();
                if (window.modeManager) {
                    window.modeManager.goTo(null);
                }
            }
        };
        
        document.body.appendChild(this.closeBtn);
    }

    // ============== Picking ==============

    _handlePointerDown(e) {
        if (!this.inSpace) return;

        if (this._pointerOverPanel) {
            return;
        }

        const panel = this._panel;
        if (panel && panel.style.display !== 'none') {
            const rect = panel.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                return;
            }
        }

        const viewport = this.renderer.domElement.getBoundingClientRect();
        this._pointer.x = ((e.clientX - viewport.left) / viewport.width) * 2 - 1;
        this._pointer.y = -((e.clientY - viewport.top) / viewport.height) * 2 + 1;

        this._raycaster.setFromCamera(this._pointer, this.camera);
        const hits = this._raycaster.intersectObjects(this.group.children, true);
        
        if (!hits.length) {
            this._clearSelectionOutline();
            this._hideInfoPanel();
            this._lastPanelMesh = null;
            this.selectedItem = null;
            this._animateCameraTopDown();
            return;
        }

        let obj = hits[0].object;
        while (obj && obj.parent && obj.parent !== this.group) obj = obj.parent;
        if (!obj || !obj.userData || !obj.userData.__libraryItem) return;

        // Toggle selection
        if (this._selectedContainer === obj) {
            this._clearSelectionOutline();
            this._hideInfoPanel();
            this._lastPanelMesh = null;
            this.selectedItem = null;
            this._animateCameraTopDown();
            return;
        }
        
        this._applySelectionOutline(obj);
        this._openInfoPanelFor(obj, obj.userData.__libraryItem);
        
        // Animate camera to focus on selected item (left side of screen)
        this._animateCameraToItem(obj);
    }

    _handlePointerMove(e) {
        if (!this.inSpace) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this._raycaster.setFromCamera(this._pointer, this.camera);
        const hits = this._raycaster.intersectObjects(this.group.children, true);
        if (!hits.length) {
            this._clearHoverOutline();
            return;
        }

        let obj = hits[0].object;
        while (obj && obj.parent && obj.parent !== this.group) obj = obj.parent;
        if (!obj || !obj.userData || !obj.userData.__libraryItem) {
            this._clearHoverOutline();
            return;
        }

        if (this._selectedContainer === obj) {
            this._clearHoverOutline();
            return;
        }

        if (this._hoveredContainer !== obj) {
            this._applyHoverOutline(obj);
        }
    }

    _handlePointerLeave() {
        if (!this.inSpace) return;
        this._clearHoverOutline();
    }

    // ============== Mesh + materials cloning ==============

    _captureMaterialsFromSolid(src) {
        const map = Object.create(null);
        src.traverse(node => {
            if (!node.isMesh) return;
            const base =
                node.userData?.__saveModeBaseMaterial ||
                node.userData?.__saveModeMaterialOriginal ||
                node.userData?.originalMaterial ||
                node.material;
            map[node.uuid] = Array.isArray(base) ? base.slice() : base;
        });
        return map;
    }

    _cloneMaterialDeep(mat) {
        if (Array.isArray(mat)) return mat.map(m => this._cloneMaterialDeep(m));
        if (!mat) return mat;
        if (mat.isShaderMaterial && THREE.UniformsUtils) {
            const cloned = mat.clone();
            cloned.uniforms = THREE.UniformsUtils.clone(mat.uniforms || {});
            cloned.defines = mat.defines ? { ...mat.defines } : cloned.defines;
            return cloned;
        }
        return mat.clone ? mat.clone() : new THREE.MeshStandardMaterial({ color: 0xffffff });
    }

    _applyMaterialsToClone(sourceRoot, cloneRoot, materialsSnapshot) {
        const srcNodes = [];
        const cloneNodes = [];
        sourceRoot.traverse(n => srcNodes.push(n));
        cloneRoot.traverse(n => cloneNodes.push(n));

        for (let i = 0; i < srcNodes.length; i++) {
            const s = srcNodes[i];
            const c = cloneNodes[i];
            if (s?.isMesh && c?.isMesh) {
                const snap = materialsSnapshot?.[s.uuid];
                if (snap !== undefined) {
                    c.material = this._cloneMaterialDeep(snap);
                } else {
                    const baseMat = (s.userData && s.userData.originalMaterial) ? s.userData.originalMaterial : s.material;
                    c.material = this._cloneMaterialDeep(baseMat);
                }
            }
        }
    }

    _cloneSolid(src, materialsSnapshot) {
        try {
            const clone = src.clone(true);
            this._applyMaterialsToClone(src, clone, materialsSnapshot);

            clone.traverse(n => { if (n.isMesh) n.matrixAutoUpdate = true; });
            clone.updateMatrixWorld(true);

            return clone;
        } catch (e) {
            console.warn('Failed to clone solid for library snapshot:', e);
            return null;
        }
    }

    // ============== Info panel ==============

    _createInfoPanel() {
        const existing = document.querySelector('.library-space-panel');
        if (existing) {
            this._attachPanelGuards(existing);
            existing.style.display = 'none';
            return existing;
        }
        const el = document.createElement('div');
        el.className = 'library-space-panel';
        this._attachPanelGuards(el);
        document.body.appendChild(el);
        return el;
    }

    _attachPanelGuards(panel) {
        if (panel.__hasLibraryGuards) return;
        panel.addEventListener('pointerenter', () => {
            this._pointerOverPanel = true;
        });
        panel.addEventListener('pointerleave', () => {
            this._pointerOverPanel = false;
        });
        panel.__hasLibraryGuards = true;
    }

    _renderPanelContents(item) {
        const isCombo = item.type === 'combination';

        let categoryLabel = '';
        if (isCombo) {
            const cats = Array.isArray(item.items)
                ? item.items.map(it =>
                    it.category ||
                    it.solid?.userData?.category ||
                    it.solutionData?.actual_category ||
                    it.audioParams?.category ||
                    ''
                ).filter(Boolean)
                : [];
            const pretty = this._uniqueCapCategories(cats);
            categoryLabel = pretty.length ? pretty.join(' - ') : 'Combination';
        } else {
            const cat =
                item.category ||
                item.solid?.userData?.category ||
                item.solutionData?.actual_category ||
                item.audioParams?.category ||
                '';
            categoryLabel = cat ? this._capitalizeFirst(String(cat)) : '';
        }

        const name = this._sanitizeName(item.name);
        const description = this._sanitizeDescription(item.description);
        const descHTML = description
            ? `<div class="library-description committed" data-editable="description">${this._escapeHTML(description)}</div>`
            : `<div class="library-description committed library-desc-placeholder" data-editable="description">Insert description here</div>`;

        this._panel.innerHTML = `
            <button class="library-close-btn" type="button" title="Close">×</button>
            <h3 class="library-name" data-editable="name" title="Click to edit name">
                ${this._escapeHTML(name)}
            </h3>
            ${categoryLabel ? `<div class="library-category-label">${this._escapeHTML(categoryLabel)}</div>` : ''}
            ${descHTML}
            <div class="library-info-actions">
                <button class="library-info-btn-play" type="button" data-action="play" title="Play">
                    <img src="/assets/icons/Play.svg" alt="Play" class="library-btn-icon-play">
                    <span>Play Sound</span>
                </button>
                <button class="library-info-btn secondary" type="button" data-action="export" title="Export">
                    <img src="/assets/icons/Export.svg" alt="Export" class="library-btn-icon">
                    <span>Export Audio</span>
                </button>
            </div>
        `;

        // Wire up interactions
        const closeBtn = this._panel.querySelector('.library-close-btn');
        const nameEl = this._panel.querySelector('[data-editable="name"]');
        const descEls = this._panel.querySelectorAll('[data-editable="description"]');
        const playBtn = this._panel.querySelector('[data-action="play"]');
        const exportBtn = this._panel.querySelector('.library-info-btn[data-action="export"]');

        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                this._clearSelectionOutline();
                this._hideInfoPanel();
                this._lastPanelMesh = null;
                this.selectedItem = null;
                this._animateCameraTopDown();
            };
        }
        
        if (nameEl) {
            nameEl.onclick = (e) => { 
                e.stopPropagation();
                e.stopImmediatePropagation();
                this._inlineEditName(nameEl, item); 
            };
        }
        
        descEls.forEach(descEl => {
            descEl.onclick = (e) => { 
                e.stopPropagation();
                e.stopImmediatePropagation();
                this._inlineEditDescription(descEl, item); 
            };
        });
        
        if (playBtn) playBtn.onclick = (e) => { e.stopPropagation(); this._handlePlay(item); };
        if (exportBtn) exportBtn.onclick = (e) => { e.stopPropagation(); this._handleExport(item); };
    }

    _openInfoPanelFor(mesh, item) {
        // FIXED: Stop any playing sounds when opening a different item
        if (this.selectedItem && this.selectedItem !== item) {
            this._stopAllLibrarySounds();
        }
        
        this._lastPanelMesh = mesh;
        this.selectedItem = item;
        this._renderPanelContents(item);

        if (this.closeBtn) {
            this.closeBtn.disabled = true;
            this.closeBtn.setAttribute('aria-disabled', 'true');
            this.closeBtn.classList.add('locked');
        }
        
        // Check if item is currently playing and update button state
        let isPlaying = false;
        if (item.type === 'combination' && Array.isArray(item.items)) {
            const ids = item.items.map(it => it.solutionData?.id ?? it.id).filter(Boolean);
            isPlaying = ids.some(id => this._playingIds.has(id));
        } else {
            const id = item?.solutionId ?? item?.solutionData?.id ?? item?.id;
            isPlaying = this._playingIds.has(id);
        }
        
        // Update button state after rendering
        requestAnimationFrame(() => {
            this._updatePlayButtonState(isPlaying);
        });
        
        this._panel.style.display = 'block';
        this._panel.offsetHeight;
        this._panel.classList.add('visible');
    }

    _hideInfoPanel() {
        // FIXED: Stop all playing sounds when panel is closed
        this._stopAllLibrarySounds();
        
        if (this._panel) {
            this._panel.classList.remove('visible');
            this._panelEditDepth = 0;
            this._panel.classList.remove('editing-active');
            this._pointerOverPanel = false;
            setTimeout(() => {
                if (!this._panel.classList.contains('visible')) {
                    this._panel.style.display = 'none';
                    if (this.closeBtn) {
                        this.closeBtn.disabled = false;
                        this.closeBtn.removeAttribute('aria-disabled');
                        this.closeBtn.classList.remove('locked');
                    }
                }
            }, 400);
        }
    }

    // ============== UI editing ==============

    _escapeHTML(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _inlineEditName(container, item) {
        if (this._isEditingName) return;
        this._isEditingName = true;
        this._beginPanelEdit();

        const current = this._sanitizeName(item.name);
        container.textContent = '';
        container.classList.remove('library-name');

        const input = document.createElement('input');
        input.type = 'text';
        input.value = current;
        input.className = 'library-name library-name-edit';
        input.maxLength = this.nameMaxLength;
        input.addEventListener('input', () => {
            if (input.value.length > this.nameMaxLength) {
                input.value = input.value.slice(0, this.nameMaxLength);
            }
        });

        container.appendChild(input);
        input.focus();
        input.select();

        let closed = false;
        const finalize = (commit) => {
            if (closed) return;
            closed = true;
            this._isEditingName = false;
            this._endPanelEdit();

            if (!container.isConnected) return;
            const value = commit
                ? this._sanitizeName(input.value)
                : current;
            if (commit) item.name = value;
            this._applyNameLayout(container, value);
        };

        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { finalize(true); input.blur(); }
            else if (e.key === 'Escape') { finalize(false); input.blur(); }
        });

        input.addEventListener('blur', () => {
            setTimeout(() => finalize(true), 50);
        });
    }

    _inlineEditDescription(container, item) {
        if (this._isEditingDesc) return;
        this._isEditingDesc = true;
        this._beginPanelEdit();

        const current = this._sanitizeDescription(item.description);
        container.textContent = '';

        const ta = document.createElement('textarea');
        ta.value = current;
        ta.className = 'library-description library-description-edit';
        ta.maxLength = this.descriptionMaxLength;
        ta.addEventListener('input', () => {
            if (ta.value.length > this.descriptionMaxLength) {
                const pos = ta.selectionStart;
                ta.value = ta.value.slice(0, this.descriptionMaxLength);
                ta.selectionStart = ta.selectionEnd = Math.min(pos, this.descriptionMaxLength);
            }
            autoSize();
        });

        container.appendChild(ta);

        ta.focus();

        const autoSize = () => {
            ta.style.height = 'auto';
            ta.style.height = `${Math.min(window.innerHeight * 0.6, ta.scrollHeight)}px`;
        };
        ta.addEventListener('input', autoSize);
        autoSize();

        let closed = false;
        const finalize = (commit) => {
            if (closed) return;
            closed = true;
            this._isEditingDesc = false;
            this._endPanelEdit();

            if (!container.isConnected) return;
            const value = commit
                ? this._sanitizeDescription(ta.value)
                : current;
            if (commit) item.description = value;
            if (value) {
                container.classList.remove('library-desc-placeholder');
                container.classList.add('library-description', 'committed');
                container.textContent = value;
            } else {
                container.classList.add('library-description', 'committed', 'library-desc-placeholder');
                container.textContent = 'Insert description here';
            }
        };

        ta.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'enter') { finalize(true); ta.blur(); }
            else if (e.key === 'Escape') { finalize(false); ta.blur(); }
        });
        
        ta.addEventListener('blur', () => {
            setTimeout(() => finalize(true), 50);
        });
    }

    _handlePlay(item) {
        const sc = this.particleSystem?.surroundController;
        if (!sc) return;

        if (item.type === 'combination' && Array.isArray(item.items)) {
            // FIXED: Extract base IDs (without generation prefix) for audio lookup
            const ids = item.items
                .map(it => it.solutionData?.id ?? it.id)
                .filter(id => id != null);
            
            // Check if ANY sound in combination is playing
            const isAnyPlaying = ids.some(id => this._playingIds.has(id));
            
            if (isAnyPlaying) {
                // Stop all sounds in this combination
                ids.forEach(id => {
                    if (this._playingIds.has(id)) {
                        this._stopLibrarySound(id);
                    }
                });
                this._updatePlayButtonState(false);
            } else {
                // FIXED: Check if sources actually exist before playing
                const validIds = ids.filter(id => sc.sources.has(id));
                if (validIds.length === 0) {
                    console.warn('⚠️ No audio sources found for combination');
                    return;
                }
                
                validIds.forEach(id => {
                    this._playLibrarySound(id, item);
                });
                this._updatePlayButtonState(true);
            }
        } else {
            // FIXED: Extract base ID (without generation prefix) for audio lookup
            const baseId = item?.solutionData?.id ?? item?.id;
            if (baseId == null) return;
            
            // FIXED: Check if source exists before playing
            if (!sc.sources.has(baseId)) {
                console.warn(`⚠️ No audio source found for solution ${baseId}`);
                return;
            }
            
            // Toggle playback using base ID
            if (this._playingIds.has(baseId)) {
                this._stopLibrarySound(baseId);
                this._updatePlayButtonState(false);
            } else {
                this._playLibrarySound(baseId, item);
                this._updatePlayButtonState(true);
            }
        }
    }

    _playLibrarySound(id, item) {
        const sc = this.particleSystem?.surroundController;
        if (!sc) return;

        const mesh = this._selectedContainer?.userData?.__solidRoot || this._lastPanelMesh;
        
        this._playingIds.add(id);
        this._playingMeshes.set(id, mesh);

        sc.playOneShot(id, {
            highlightMesh: mesh,
            onEnded: () => {
                this._playingIds.delete(id);
                this._playingMeshes.delete(id);
                
                if (this._playingIds.size === 0) {
                    this._updatePlayButtonState(false);
                }
                
                if (this._playingIds.size === 0) {
                    this._clearSelectionOutline();
                }
            },
            allowOverlap: true
        });
    }

    _stopLibrarySound(id) {
        const sc = this.particleSystem?.surroundController;
        if (!sc) return;

        const sourceData = sc.sources.get(id);
        if (sourceData && sc._isSourcePlaying(sourceData)) {
            // CHANGED: Use fade-out instead of immediate stop
            sc._stopSource(sourceData, true); // true = fade out
        }

        this._playingIds.delete(id);
        this._playingMeshes.delete(id);
    }

    _stopAllLibrarySounds() {
        const sc = this.particleSystem?.surroundController;
        if (!sc) return;

        console.log('🔇 Stopping all library sounds');

        // Stop each playing sound with fade
        for (const id of Array.from(this._playingIds)) {
            this._stopLibrarySound(id);
        }

        // Clear tracking
        this._playingIds.clear();
        this._playingMeshes.clear();

        // Update UI
        this._updatePlayButtonState(false);
        
        console.log('✅ All library sounds stopped');
    }

    _updatePlayButtonState(isPlaying) {
        if (!this._panel) return;
        
        const playBtn = this._panel.querySelector('[data-action="play"]');
        const playIcon = this._panel.querySelector('.library-btn-icon-play');
        const playText = playBtn?.querySelector('span');
        
        if (!playBtn || !playIcon || !playText) return;

        if (isPlaying) {
            playIcon.src = '/assets/icons/Stop.svg';
            playIcon.alt = 'Stop';
            playText.textContent = 'Stop Sound';
            playBtn.classList.add('playing');
        } else {
            playIcon.src = '/assets/icons/Play.svg';
            playIcon.alt = 'Play';
            playText.textContent = 'Play Sound';
            playBtn.classList.remove('playing');
        }
    }

    _handleExport(item) {
        const sc = this.particleSystem?.surroundController;
        if (!sc) {
            console.warn('⚠️ No audio controller available for export');
            return;
        }

        // Helper to trigger download
        const downloadAudio = (audioBuffer, filename) => {
            if (!audioBuffer) {
                console.error('❌ No audio buffer to export');
                return;
            }

            try {
                // Convert AudioBuffer to WAV format
                const wavBlob = this._audioBufferToWav(audioBuffer);
                
                // Create download link
                const url = URL.createObjectURL(wavBlob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                
                document.body.appendChild(a);
                a.click();
                
                // Cleanup
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);
                
                console.log(`✅ Exported audio: ${filename}`);
            } catch (error) {
                console.error('❌ Failed to export audio:', error);
            }
        };

        if (item.type === 'combination' && Array.isArray(item.items)) {
            // FIXED: Extract base IDs (without generation prefix) for audio lookup
            const ids = item.items
                .map(it => it.solutionData?.id ?? it.id)
                .filter(id => id != null);
            
            const buffers = ids
                .map(id => sc.sources.get(id)?.buffer)
                .filter(Boolean);

            if (buffers.length === 0) {
                console.warn('⚠️ No audio buffers found for combination');
                return;
            }

            // Mix all buffers
            const mixedBuffer = this._mixAudioBuffers(buffers, sc.audioContext);
            const filename = `${this._sanitizeFilename(item.name || 'combination')}.wav`;
            downloadAudio(mixedBuffer, filename);

        } else {
            // FIXED: Extract base ID (without generation prefix) for audio lookup
            const baseId = item?.solutionData?.id ?? item?.id;
            if (baseId == null) {
                console.warn('⚠️ No solution ID found');
                return;
            }

            const sourceData = sc.sources.get(baseId);
            if (!sourceData?.buffer) {
                console.warn(`⚠️ No audio buffer found for solution ${baseId}`);
                return;
            }

            const filename = `${this._sanitizeFilename(item.name || `solution_${baseId}`)}.wav`;
            downloadAudio(sourceData.buffer, filename);
        }
    }

    _sanitizeFilename(name) {
        // Remove invalid filename characters
        return String(name)
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 100);
    }

    _audioBufferToWav(audioBuffer) {
        const numberOfChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        const bytesPerSample = bitDepth / 8;
        const blockAlign = numberOfChannels * bytesPerSample;

        const samples = audioBuffer.length;
        const dataSize = samples * blockAlign;
        const bufferSize = 44 + dataSize;

        const buffer = new ArrayBuffer(bufferSize);
        const view = new DataView(buffer);

        // Write WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, bufferSize - 8, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, format, true);
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        // Write audio data
        const channelData = [];
        for (let i = 0; i < numberOfChannels; i++) {
            channelData.push(audioBuffer.getChannelData(i));
        }

        let offset = 44;
        for (let i = 0; i < samples; i++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                // Convert float32 (-1 to 1) to int16 (-32768 to 32767)
                const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
                const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(offset, int16, true);
                offset += 2;
            }
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    _mixAudioBuffers(buffers, audioContext) {
        if (buffers.length === 0) return null;
        if (buffers.length === 1) return buffers[0];

        // Find the longest buffer
        const maxLength = Math.max(...buffers.map(b => b.length));
        const numberOfChannels = Math.max(...buffers.map(b => b.numberOfChannels));
        const sampleRate = buffers[0].sampleRate;

        // Create output buffer
        const mixedBuffer = audioContext.createBuffer(
            numberOfChannels,
            maxLength,
            sampleRate
        );

        // Mix all buffers
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const outputData = mixedBuffer.getChannelData(channel);

            for (const buffer of buffers) {
                const channelIdx = Math.min(channel, buffer.numberOfChannels - 1);
                const inputData = buffer.getChannelData(channelIdx);

                for (let i = 0; i < inputData.length; i++) {
                    outputData[i] = (outputData[i] || 0) + inputData[i] / buffers.length;
                }
            }

            // Normalize if clipping occurs
            let max = 0;
            for (let i = 0; i < outputData.length; i++) {
                const abs = Math.abs(outputData[i]);
                if (abs > max) max = abs;
            }
            if (max > 1) {
                for (let i = 0; i < outputData.length; i++) {
                    outputData[i] /= max;
                }
            }
        }

        return mixedBuffer;
    }
    // ============== Outline helpers (SaveMode-style) ==============

    _applyHoverOutline(root) {
        this._clearHoverOutline();
        this._hoveredContainer = root;
        const highlightColor = new THREE.Color(0xffff88);
        
        root.traverse(child => {
            if (!child.isMesh) return;
            
            const originalMaterial = this._globalLibraryMaterialCache.get(child);
            if (!originalMaterial) return;
            
            // Clone original and apply hover tint
            const tinted = this._createTintedMaterial(originalMaterial, 0.3, highlightColor);
            child.material = tinted;
        });
    }

    _clearHoverOutline() {
        if (!this._hoveredContainer) return;
        
        this._hoveredContainer.traverse(child => {
            if (!child.isMesh) return;
            
            // Restore from cache
            const originalMaterial = this._globalLibraryMaterialCache.get(child);
            if (originalMaterial) {
                child.material = originalMaterial;
            }
        });
        
        this._hoveredContainer = null;
    }

    _applySelectionOutline(root) {
        this._clearSelectionOutline();
        this._selectedContainer = root;
        const highlightColor = new THREE.Color(0x53d3c0);
        
        root.traverse(child => {
            if (!child.isMesh) return;
            
            const originalMaterial = this._globalLibraryMaterialCache.get(child);
            if (!originalMaterial) return;
            
            // Clone original and apply selection tint
            const tinted = this._createTintedMaterial(originalMaterial, 0.5, highlightColor);
            child.material = tinted;
        });
    }

    _clearSelectionOutline() {
        if (!this._selectedContainer) return;
        
        this._selectedContainer.traverse(child => {
            if (!child.isMesh) return;
            
            // Restore from cache
            const originalMaterial = this._globalLibraryMaterialCache.get(child);
            if (originalMaterial) {
                child.material = originalMaterial;
            }
        });
        
        this._selectedContainer = null;
    }

    _createTintedMaterial(source, intensity, highlightColor) {
        if (!source || typeof source.clone !== 'function') {
            console.warn('⚠️ Cannot clone material:', source);
            return source;
        }
        
        try {
            const cloned = source.clone();
            
            if ('emissive' in cloned && cloned.emissive && typeof cloned.emissive.copy === 'function') {
                cloned.emissive.copy(highlightColor);
                cloned.emissiveIntensity = Math.max(intensity, cloned.emissiveIntensity ?? 0);
            }
            
            if ('color' in cloned && cloned.color && typeof cloned.color.lerp === 'function') {
                cloned.color = cloned.color.clone().lerp(highlightColor, 0.45);
            }
            
            cloned.transparent = true;
            cloned.opacity = Math.min(0.95, source.opacity ?? 1);
            cloned.needsUpdate = true;
            
            return cloned;
        } catch (e) {
            console.warn('⚠️ Failed to create tinted material:', e);
            return source;
        }
    }

    // ============== Helper methods ==============

    _findPrimaryMesh(root) {
        let primary = null;
        root.traverse(n => {
            if (n.isMesh && n.userData && n.userData.isPrimary) {
                primary = n;
            }
        });
        return primary || root;
    }

    _retargetUpdateFunctionsForClone(runtime) {
        // Placeholder for animation retargeting
    }

    _updateLibrarySolidsAnimation() {
        // Placeholder for solid animation updates
    }

    _beginPanelEdit() {
        this._panelEditDepth++;
        if (this._panel) this._panel.classList.add('editing-active');
    }

    _endPanelEdit() {
        this._panelEditDepth = Math.max(0, this._panelEditDepth - 1);
        if (this._panelEditDepth === 0 && this._panel) {
            this._panel.classList.remove('editing-active');
        }
    }

    _applyNameLayout(container, name) {
        container.textContent = '';
        container.classList.add('library-name');
        
        if (name.length > this.nameVerticalThreshold) {
            container.classList.add('vertical');
        } else {
            container.classList.remove('vertical');
        }
        
        container.textContent = name;
    }

    _sanitizeName(name) {
        return String(name || '').trim().slice(0, this.nameMaxLength) || '(unnamed)';
    }

    _sanitizeDescription(desc) {
        return String(desc || '').trim().slice(0, this.descriptionMaxLength);
    }

    _capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }

    _uniqueCapCategories(arr) {
        const seen = new Set();
        const result = [];
        for (const cat of arr) {
            const lower = String(cat).toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                result.push(this._capitalizeFirst(cat));
            }
        }
        return result;
    }

    _positionInfoPanel() {
        // Placeholder for panel positioning logic
    }
}