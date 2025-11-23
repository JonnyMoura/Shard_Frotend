import * as THREE from 'three';
import { Button } from './Button.js';

export class EvolvingUI {
    constructor(mainRenderer, mainCamera, controls, particleSystem, pythonCommunication, library) {
        this.mainRenderer = mainRenderer;
        this.mainCamera = mainCamera;
        this.controls = controls;
        this.particleSystem = particleSystem;
        this.pythonCommunication = pythonCommunication;
        this.library = library;

        // **NEW: Scene transition mode storage**
        this.allSolutions = [];
        this.categoryMeshes = {
            'low': [],
            'mid': [],
            'high': [],
            'rhythmic': []
        };
        
        // **NEW: Scoring storage**
        this.allTabScores = new Map();
        this.submitButton = null;
        
        // **Scoring system bounds**
        
        this.scoreArea = {
            minY: -12,
            maxY: 30,
            minScore: 0.0,
            maxScore: 1.0
        };

        this.solidMeshes = this.particleSystem.getSolids ? this.particleSystem.getSolids() : [];
        this.numSolids = this.solidMeshes.length;
        this.activeTab = 'low';

        // Store original camera and solid positions**
        this.originalCameraPosition = this.mainCamera.position.clone();
        this.originalCameraTarget = this.controls && this.controls.target ? this.controls.target.clone() : new THREE.Vector3();
        this.originalSolidPositions = new Map();
        this.isEvolvingMode = false;

        // Interaction state**
        this.drag = {
            active: false,
            mesh: null,
            playingId: null
        };
        this.dragYScale = 0.04;

        // Persist Y per-tab until submit
        this.savedYByTab = new Map();
        this.idToGlobalIndex = new Map();
        this.globalBaselineCenterY = null;

        // NEW: track which tabs were actually opened/aligned this session
        this.visitedTabs = new Set();
        
        // ADDED: Submission flag
        this._isSubmitting = false;

        // 'auto-average' = average center-Y of all solids at enterEvolvingMode (default)
        
        this.baselineMode = 'auto-average';
        //this.fixedBaselineCenterY = 10;  

       
        this.fixedCameraTargetPos = null;   // THREE.Vector3
        this.fixedCameraTargetLook = new THREE.Vector3(0, 0, 0);
        
        // Look for existing button
        const existingEvolveBtn = document.getElementById('evolve-btn');
        if (existingEvolveBtn) {
            this.evolveBtn = existingEvolveBtn;
        } else {
            this.evolveBtn = new Button('EVOLVE', 'hamburger', () => {});
        }

        // Remove any old toggle handlers so modeManager has full control
        const detachClick = (btnRef) => {
            if (!btnRef) return;
            if (btnRef.button instanceof HTMLElement) {
                btnRef.button.onclick = null;
            } else if (btnRef.element instanceof HTMLElement) {
                btnRef.element.onclick = null;
            } else if (btnRef instanceof HTMLElement) {
                btnRef.onclick = null;
            }
        };
        detachClick(this.evolveBtn);

        this.evolveBtn.onclick = () => this.toggleEvolvingMode();
        
        this.createTabsUI();
        this.createReferenceScale();
        this.createCloseButton(); // NEW: Add close button
        this.setupInteraction();
    }

      createTabsUI() {
        // Create floating tabs interface
        this.tabsContainer = document.createElement('div');
        this.tabsContainer.className = 'evolve-tabs-floating';
        this.tabsContainer.style.display = 'none'; 

        const tabs = [
            { id: 'low', label: 'Low' },
            { id: 'mid', label: 'Mid' },
            { id: 'high', label: 'High' },
            { id: 'rhythmic', label: 'Rhythmic' }
        ];

        tabs.forEach(tab => {
            const tabButton = document.createElement('button');
            tabButton.className = 'evolve-tab-button';
            tabButton.textContent = tab.label;
            tabButton.dataset.value = tab.id;
            if (tab.id === this.activeTab) tabButton.classList.add('active');

            tabButton.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchTab(tab.id);
            });

            this.tabsContainer.appendChild(tabButton);
        });

        document.body.appendChild(this.tabsContainer);
    }

    // NEW: Create visual reference scale
createReferenceScale() {
    // Create scale container
    this.scaleContainer = document.createElement('div');
    this.scaleContainer.className = 'evolve-reference-scale';
    this.scaleContainer.style.display = 'none';
    
    // Create vertical line
    const line = document.createElement('div');
    line.className = 'scale-line';
    
    // Create top label
    const topLabel = document.createElement('div');
    topLabel.className = 'scale-label scale-label-top';
    topLabel.textContent = 'Best Sound';
    
    // Create bottom label
    const bottomLabel = document.createElement('div');
    bottomLabel.className = 'scale-label scale-label-bottom';
    bottomLabel.textContent = 'Worse Sound';
    
    this.scaleContainer.appendChild(topLabel);
    this.scaleContainer.appendChild(line);
    this.scaleContainer.appendChild(bottomLabel);
    
    document.body.appendChild(this.scaleContainer);
}

    // NEW: Update reference scale visual position
updateReferenceScalePosition() {
    if (!this.scaleContainer) return;
    
    // Get the current solids for active tab to find their baseline position
    const filtered = this.getSolidsByTab(this.activeTab);
    
    if (filtered.length === 0) {
        // Hide scale if no solids
        this.scaleContainer.style.display = 'none';
        return;
    }
    
    this.scaleContainer.style.display = 'flex';
    
    // Project score area min/max to screen space
    const baselineY = (typeof this.globalBaselineCenterY === 'number') 
        ? this.globalBaselineCenterY 
        : this.scoreArea.minY;
    
    const bottomWorld = new THREE.Vector3(0, baselineY, this.fixedCameraTargetLook?.z ?? 0);
    const topWorld = new THREE.Vector3(0, this.scoreArea.maxY, this.fixedCameraTargetLook?.z ?? 0);
    
    const bottomScreen = this.worldToScreen(bottomWorld);
    const topScreen = this.worldToScreen(topWorld);
    
    // Calculate scale dimensions
    const scaleHeight = bottomScreen.y - topScreen.y;
    const scaleTop = topScreen.y;
    
    // Position scale on LEFT side (changed from 88% to 12%)
    const leftOffset = window.innerWidth * 0.12; // 12% from left
    
    // Update scale container
    this.scaleContainer.style.top = `${scaleTop}px`;
    this.scaleContainer.style.left = `${leftOffset}px`;
    this.scaleContainer.style.height = `${scaleHeight}px`;
    
    // Update line height
    const line = this.scaleContainer.querySelector('.scale-line');
    if (line) {
        line.style.height = `${scaleHeight}px`;
    }
}

// Add this helper method to convert world position to screen coordinates
worldToScreen(worldPos) {
    const vector = worldPos.clone();
    vector.project(this.mainCamera);
    
    return {
        x: (vector.x * 0.5 + 0.5) * window.innerWidth,
        y: (vector.y * -0.5 + 0.5) * window.innerHeight
    };
}

    toggleEvolvingMode() {
        if (this.isEvolvingMode) {
            this.exitEvolvingMode();
        } else {
            this.enterEvolvingMode();
        }
    }

    // Helper: get solids for a specific tab
    getSolidsByTab(tabId) {
        return this.solidMeshes.filter(m => {
            const cat = m.userData?.solution?.actual_category;
            return typeof cat === 'string' && cat.toLowerCase() === tabId;
        });
    }

    // Compute spacing/total depth/camera for a given solids array
    computeLayoutMetricsForSolids(solids) {
        if (!solids || solids.length === 0) {
            return {
                count: 0,
                spacing: 0,
                totalDepth: 0,
                camDist: 70,
                targetPos: new THREE.Vector3(70, 10, 0),
                targetLook: new THREE.Vector3(0, 0, 0),
            };
        }
        let maxDepth = 1;
        const box = new THREE.Box3();
        for (const m of solids) {
            box.setFromObject(m);
            const dz = box.getSize(new THREE.Vector3()).z;
            if (dz > maxDepth) maxDepth = dz;
        }
        const spacing = maxDepth * 1.35;
        const totalDepth = (solids.length - 1) * spacing;
        const camDist = Math.max(25, totalDepth * 0.9 + 70);
        const targetPos = new THREE.Vector3(camDist, 10, 0);
        const targetLook = new THREE.Vector3(0, 0, 0);
        return { count: solids.length, spacing, totalDepth, camDist, targetPos, targetLook };
    }

    // Compute fixed camera based on the tab that has the most solutions
    computeFixedCameraFromMaxTab() {
        const tabs = ['low', 'mid', 'high', 'rhythmic'];
        let best = { tab: null, metrics: null };

        for (const tab of tabs) {
            const solids = this.getSolidsByTab(tab);
            const metrics = this.computeLayoutMetricsForSolids(solids);
            if (!best.metrics) {
                best = { tab, metrics };
            } else {
                // Prefer higher count; tiebreaker by larger totalDepth
                if (metrics.count > best.metrics.count ||
                    (metrics.count === best.metrics.count && metrics.totalDepth > best.metrics.totalDepth)) {
                    best = { tab, metrics };
                }
            }
        }

        // Fallback if no tab has solids
        if (!best.metrics) {
            best.metrics = this.computeLayoutMetricsForSolids([]);
            best.tab = 'low';
        }

        this.fixedCameraTargetPos = best.metrics.targetPos.clone();
        this.fixedCameraTargetLook = best.metrics.targetLook.clone();
        console.log('[Evolve] Fixed camera chosen from tab:', best.tab, 'metrics:', {
            count: best.metrics.count,
            spacing: best.metrics.spacing,
            totalDepth: best.metrics.totalDepth,
            targetPos: { x: this.fixedCameraTargetPos.x, y: this.fixedCameraTargetPos.y, z: this.fixedCameraTargetPos.z },
            targetLook: { x: this.fixedCameraTargetLook.x, y: this.fixedCameraTargetLook.y, z: this.fixedCameraTargetLook.z },
        });
    }

    // Compute a single baseline center-Y from all solids (average of their centers)
    computeGlobalBaselineCenterY() {
        if (!this.solidMeshes || this.solidMeshes.length === 0) return 0;
        const box = new THREE.Box3();
        let sum = 0, n = 0;
        for (const m of this.solidMeshes) {
            box.setFromObject(m);
            const c = box.getCenter(new THREE.Vector3());
            if (Number.isFinite(c.y)) { sum += c.y; n++; }
        }
        return n ? sum / n : 0;
    }

    // Optional helper to set a fixed baseline at runtime
    setInitialBaselineY(y) {
        this.baselineMode = 'fixed';
        this.fixedBaselineCenterY = y;
        if (this.isEvolvingMode) {
            this.globalBaselineCenterY = y;
            console.log('[Evolve] Baseline switched to fixed:', y);
            this.transitionToEvolvingLayout(); // re-align current tab
        }
    }

    enterEvolvingMode() {
        // Guard clause
        if (!this.particleSystem.peaks || this.particleSystem.peaks.length === 0) {
            console.warn('⚠️ Cannot enter evolving mode - no peaks initialized');
            return;
        }

        console.log('🎮 Entering evolving mode');
        this.isEvolvingMode = true;

        this.storeOriginalPositions();

        // NEW: Change button text and set selected state
        
        setTimeout(() => {
            this.evolveBtn.setSelected(true);
        }, 500);

        // Stop main soundscape and fade out
        try {
            this.particleSystem?.surroundController?.startMode(500);
        } catch {}

        if (this.controls) this.controls.enabled = false;
        if (this.tabsContainer) this.tabsContainer.style.display = 'flex';

        this.solidMeshes = this.particleSystem.getSolids ? this.particleSystem.getSolids() : this.solidMeshes;

        this.savedYByTab.clear();
        this.visitedTabs.clear();
        this.solidMeshes.forEach(m => { delete m.userData.hasUserDragged; });

        if (this.baselineMode === 'fixed') {
            this.globalBaselineCenterY = this.fixedBaselineCenterY;
            console.log('[Evolve] Global baseline center-Y set (fixed) to', this.globalBaselineCenterY);
        } else {
            this.globalBaselineCenterY = this.computeGlobalBaselineCenterY();
            console.log('[Evolve] Global baseline center-Y set (auto-average) to', this.globalBaselineCenterY);
        }

        this.computeFixedCameraFromMaxTab();

        this.loadSolutionsFromParticleSystem();

        
        this.alignAllSolidsToBaselineOrSaved();

        this.transitionToEvolvingLayout();

        this.solidMeshes.forEach(m => { if (m.visible) m.userData.evolvingManualY = true; });
        
        // REMOVED: Don't show scale immediately
        // if (this.scaleContainer) {
        //     this.scaleContainer.style.display = 'flex';
        //     setTimeout(() => {
        //         this.updateReferenceScalePosition();
        //     }, 100);
        // }
        
        // NEW: Show close button
        if (this.closeBtn) {
            this.closeBtn.style.display = 'block';
        }
        
        this.createSubmitButton();
    }

    // NEW: Align the vertical center of ALL solids to saved Y (per-tab) or baseline
    alignAllSolidsToBaselineOrSaved() {
        if (!this.solidMeshes?.length) return;
        const baselineY = (typeof this.globalBaselineCenterY === 'number') ? this.globalBaselineCenterY : 0;

        const getTabId = (mesh) => {
            const cat = mesh.userData?.solution?.actual_category;
            return typeof cat === 'string' ? cat.toLowerCase() : null;
        };
        const getSavedYForTab = (tabId, mesh) => this.savedYByTab.get(`${tabId}_${mesh.uuid}`);

        for (const m of this.solidMeshes) {
            const tabId = getTabId(m);
            if (!tabId || !['low','mid','high','rhythmic'].includes(tabId)) continue;

            const savedCenterY = getSavedYForTab(tabId, m);
            const finalCenterY = (typeof savedCenterY === 'number') ? savedCenterY : baselineY;

            m.updateMatrixWorld(true);
            const b0 = new THREE.Box3().setFromObject(m);
            const c0 = b0.getCenter(new THREE.Vector3());

            // Move so center == finalCenterY
            const dy = finalCenterY - c0.y;
            if (Math.abs(dy) > 0) {
                m.position.y += dy;
                m.updateMatrixWorld(true);

                // snap-correct residue
                const b1 = new THREE.Box3().setFromObject(m);
                const c1 = b1.getCenter(new THREE.Vector3());
                const err = finalCenterY - c1.y;
                if (Math.abs(err) > 1e-3) {
                    m.position.y += err;
                    m.updateMatrixWorld(true);
                }

                // Cache offsets for grain “top” and clamp baseline
                const sizeAfter = b1.getSize(new THREE.Vector3());
                m.userData.centerOffsetY = c1.y - m.position.y;
                m.userData.grainClearance = (sizeAfter.y * 0.5) + 4.0;
                m.userData.evolvingBaseY = baselineY;

                // Keep peak Y unchanged; just update manualHeight mapping
                const peakIndex = this.particleSystem.peakSolids.indexOf(m);
                if (peakIndex !== -1) {
                    const peak = this.particleSystem.peaks[peakIndex];
                    if (peak) {
                        // DON'T unlock - keep evolvingLock = true
                        // peak.evolvingLock = false;  // <-- REMOVE THIS LINE
                        peak.manualHeight = this.calculateSmoothedHeightFromY(finalCenterY);
                    }
                }
            } else {
                // Even if already aligned, ensure clamp is set
                m.userData.evolvingBaseY = baselineY;
            }
        }
    }
   

    exitEvolvingMode() {
        if (!this.isEvolvingMode) return;
        console.log('🚪 Exiting evolving mode');
        
        this.isEvolvingMode = false;

        // CRITICAL: Stop ALL audio FIRST
        try {
            this.particleSystem?.surroundController?.stopAllManualPlayback();
        } catch (e) {
            console.error('Failed to stop audio on evolve exit:', e);
        }

        // NEW: Change button text back and remove selected state
        this.evolveBtn.setSelected(false);
        
        if (this.controls) this.controls.enabled = true;
        if (this.tabsContainer) this.tabsContainer.style.display = 'none';

        if (this.particleSystem?.stopEvolvingAlignment) this.particleSystem.stopEvolvingAlignment();
        if (this.particleSystem?.clearCategoryVisibility) this.particleSystem.clearCategoryVisibility();

        this.restoreOriginalLayout();
        this.solidMeshes.forEach(m => { delete m.userData.evolvingManualY; });

        if (this.submitButton) {
            this.submitButton.remove();
            this.submitButton = null;
        }

        // NEW: Hide reference scale
        if (this.scaleContainer) {
            this.scaleContainer.style.display = 'none';
        }
        
        // NEW: Hide close button
        if (this.closeBtn) {
            this.closeBtn.style.display = 'none';
        }
        
        this.hideNoSolutionsMessage();
    }

    storeOriginalPositions() {
        // Store original camera position
        this.originalCameraPosition.copy(this.mainCamera.position);
        if (this.controls && this.controls.target) {
            this.originalCameraTarget.copy(this.controls.target);
        }

        // Store original solid positions
        this.originalSolidPositions.clear();
        this.solidMeshes.forEach(m => {
            this.originalSolidPositions.set(m.uuid, {
                position: m.position.clone(),
                rotation: m.rotation.clone(),
                scale: m.scale.clone()
            });
        });
    }

    // Robust center getter
    getMeshCenterY(mesh) {
        mesh.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(mesh);
        const c = b.getCenter(new THREE.Vector3());
        return c.y;
    }

    // Align along Z and vertically align to baseline or saved per-tab Y
    transitionToEvolvingLayout() {
        const filtered = this.getSolidsByTab(this.activeTab);

        // Only show solids in the active tab
        this.solidMeshes.forEach(m => { m.visible = filtered.includes(m); });

        
        if (this.particleSystem && typeof this.particleSystem.applyCategoryVisibilityBySolids === 'function') {
            this.particleSystem.applyCategoryVisibilityBySolids(filtered, 300);
        }

        // NEW: Handle empty tabs
        if (filtered.length === 0) {
            // Still animate camera to the fixed position
            const targetPos = this.fixedCameraTargetPos ?? new THREE.Vector3(70, 10, 0);
            const targetLook = this.fixedCameraTargetLook ?? new THREE.Vector3(0, 0, 0);
            
            console.log(`[Evolve] Tab=${this.activeTab} is empty, moving camera to fixed position`);
            
            this.animateCamera(targetPos, targetLook, 800, () => {
                // CHANGED: Hide scale when empty
                if (this.scaleContainer) {
                    this.scaleContainer.style.display = 'none';
                }
            });
            
            // Show "no solutions" message
            this.showNoSolutionsMessage(this.activeTab);
            return;
        }

        // Hide message if there are solutions
        this.hideNoSolutionsMessage();

        // Camera: fixed for this session
        const layout = this.computeLayoutMetricsForSolids(filtered);
        const targetPos = this.fixedCameraTargetPos ?? layout.targetPos;
        const targetLook = this.fixedCameraTargetLook ?? layout.targetLook;
        console.log(`[Evolve] Tab=${this.activeTab} camera targetPos=`, { x: targetPos.x, y: targetPos.y, z: targetPos.z },
                    'targetLook=', { x: targetLook.x, y: targetLook.y, z: targetLook.z });
        
        this.animateCamera(targetPos, targetLook, 800, () => {
            // NEW: Update scale area and show scale AFTER camera finishes
         
            
            // CHANGED: Show scale only after camera animation completes
            if (this.scaleContainer) {
                this.scaleContainer.style.display = 'flex';
                this.updateReferenceScalePosition();
            }
            
            console.log(`[Evolve] Tab=${this.activeTab} camera final=`, {
                pos: { x: this.mainCamera.position.x, y: this.mainCamera.position.y, z: this.mainCamera.position.z },
                look: this.controls && this.controls.target
                    ? { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z }
                    : null
            });
        });

        const baselineY = (typeof this.globalBaselineCenterY === 'number') ? this.globalBaselineCenterY : 0;
        const keyFor = (mesh) => `${this.activeTab}_${mesh.uuid}`;
        const getSavedY = (mesh) => this.savedYByTab.get(keyFor(mesh));

        // Vertical align pass with snap-correction
        filtered.forEach(m => {
            // desired center-Y: saved (if dragged in this tab), else baseline
            const savedCenterY = getSavedY(m);
            const finalCenterY = (typeof savedCenterY === 'number') ? savedCenterY : baselineY;

            // compute current center
            m.updateMatrixWorld(true);
            const b0 = new THREE.Box3().setFromObject(m);
            const c0 = b0.getCenter(new THREE.Vector3());

            // move so center == finalCenterY
            const dy = finalCenterY - c0.y;
            m.position.y += dy;
            m.updateMatrixWorld(true);

            // snap-correct any tiny residue due to parenting/rounding
            const b1 = new THREE.Box3().setFromObject(m);
            const c1 = b1.getCenter(new THREE.Vector3());
            const err = finalCenterY - c1.y;
            if (Math.abs(err) > 1e-3) {
                m.position.y += err;
                m.updateMatrixWorld(true);
            }

            // Clamp baseline for dragging
            m.userData.evolvingBaseY = baselineY;

            // Cache offsets so ParticleSystem can compute "topY" under the solid (no overlap)
            const sizeAfter = b1.getSize(new THREE.Vector3());
            m.userData.centerOffsetY = c1.y - m.position.y;          // centerY = pos.y + centerOffsetY
            m.userData.grainClearance = (sizeAfter.y * 0.5) + 4.0;    // half-height + margin

            // Peak: keep Y unchanged; grains use manualHeight mapping only
            const peakIndex = this.particleSystem.peakSolids.indexOf(m);
            if (peakIndex !== -1) {
                const peak = this.particleSystem.peaks[peakIndex];
                if (peak) {
                    peak.evolvingLock = false;
                    peak.manualHeight = this.calculateSmoothedHeightFromY(finalCenterY);
                }
            }
        });

        // Arrange peaks along Z only (keep existing Y)
        const targets = [];
        filtered.forEach((mesh, i) => {
            const targetZ = (filtered.length === 1) ? 0 : (-layout.totalDepth / 2 + i * layout.spacing);
            mesh.userData.evolvingIndex = i;

            const peakIndex = this.particleSystem.peakSolids.indexOf(mesh);
            if (peakIndex !== -1) {
                const keepY = this.particleSystem.peaks[peakIndex]?.currentPyramidCenter.y ?? 0;
                const targetCenter = new THREE.Vector3(0, keepY, targetZ);
                targets.push({ solid: mesh, target: targetCenter });
                const peak = this.particleSystem.peaks[peakIndex];
                if (peak) delete peak.evolvingLock;
            }
        });
        if (targets.length && this.particleSystem?.startEvolvingAlignmentInstant) {
            this.particleSystem.startEvolvingAlignmentInstant(targets);
        }

        // mark this tab as aligned/visited
        this.visitedTabs.add(this.activeTab);
    }

    // Animate camera 
    animateCamera(targetPos, targetLook, duration = 800, onComplete = null) {
        const startPos = this.mainCamera.position.clone();
        const startLook = (this.controls && this.controls.target) ? this.controls.target.clone() : new THREE.Vector3();
        const start = performance.now();

        const step = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const e = (t < 0.5) ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
            this.mainCamera.position.lerpVectors(startPos, targetPos, e);
            if (this.controls && this.controls.target) {
                this.controls.target.lerpVectors(startLook, targetLook, e);
                this.controls.update();
            } else {
                this.mainCamera.lookAt(targetLook);
            }
            if (t < 1) {
                requestAnimationFrame(step);
            } else if (typeof onComplete === 'function') {
                onComplete();
            }
        };
        requestAnimationFrame(step);
    }

    setupInteraction() {
        if (this._interactionSetupDone) return;
        this._interactionSetupDone = true;

        const canvas = this.mainRenderer.domElement;
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();

        const pickTopLevelMesh = (event) => {
            const rect = canvas.getBoundingClientRect();
            pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(pointer, this.mainCamera);
            const visible = this.solidMeshes.filter(m => m.visible);
            const hits = raycaster.intersectObjects(visible, true);
            if (!hits.length) return null;
            let obj = hits[0].object;
            while (obj && !this.solidMeshes.includes(obj) && obj.parent) obj = obj.parent;
            return this.solidMeshes.includes(obj) ? obj : null;
        };

        const onPointerDown = (e) => {
            if (!this.isEvolvingMode) return;

            e.preventDefault();
            e.stopPropagation();

            // Stop anything that might still be playing (mirrors SaveMode)
            try {
                this.particleSystem?.surroundController?.stopAllManualPlayback();
            } catch (err) {
                console.error('Failed to stop audio before drag start:', err);
            }

            const mesh = pickTopLevelMesh(e);
            if (!mesh || mesh.userData.evolvingIndex === undefined) return;

            this.drag.active = true;
            this.drag.mesh = mesh;
            this.drag.startPointerY = e.clientY;
            this.drag.startY = mesh.position.y;

            const box = new THREE.Box3().setFromObject(mesh);
            mesh.userData.dragStartCenterY = box.getCenter(new THREE.Vector3()).y;
            if (mesh.userData.evolvingBaseY === undefined) {
                mesh.userData.evolvingBaseY = this.globalBaselineCenterY;
            }

            this.drag.peakIndex = this.particleSystem.peakSolids.indexOf(mesh);

            const id = mesh?.userData?.solution?.id ?? null;
            this.drag.playingId = id;
            if (id != null) {
                try {
                    this.particleSystem?.surroundController?.playLoopForMesh(id, mesh);
                } catch (err) {
                    console.error('Failed to start loop during drag:', err);
                }
            }

            canvas.style.cursor = 'grabbing';
        };

        const onPointerMove = (e) => {
            if (!this.drag.active || !this.drag.mesh) return;
            const deltaPixels = this.drag.startPointerY - e.clientY;
            let newY = this.drag.startY + deltaPixels * this.dragYScale;

            // Clamp: cannot go below global baseline (only upwards)
            const b = new THREE.Box3().setFromObject(this.drag.mesh);
            const currentCenter = b.getCenter(new THREE.Vector3());
            const centerOffset = currentCenter.y - this.drag.mesh.position.y; 
            const minCenterY = this.drag.mesh.userData.evolvingBaseY;
            const maxCenterY = this.scoreArea.maxY;
            const minPosY = minCenterY - centerOffset;
            const maxPosY = maxCenterY - centerOffset;
            newY = Math.max(minPosY, Math.min(maxPosY, newY));

            // Move solid
            this.drag.mesh.position.y = newY;
            this.drag.mesh.userData.evolvingManualY = true;

            // New center after move
            const b2 = new THREE.Box3().setFromObject(this.drag.mesh);
            const newCenter = b2.getCenter(new THREE.Vector3());

            
            this.setSavedYForActiveTab(this.drag.mesh, newCenter.y);

            
            const moved = Math.abs((this.drag.mesh.userData.dragStartCenterY ?? newCenter.y) - newCenter.y) > 0.05;
            if (moved) this.drag.mesh.userData.hasUserDragged = true;

            // Update grains distribution mapping only (keep peak XZ locked)
            if (Number.isInteger(this.drag.peakIndex) && this.drag.peakIndex >= 0) {
                const peak = this.particleSystem.peaks[this.drag.peakIndex];
                if (peak) {
                    // DON'T unlock the peak - keep evolvingLock = true
                    // peak.evolvingLock = false;  // <-- REMOVE THIS LINE
                    peak.manualHeight = this.smoothedHeightFromY(newCenter.y);
                }
            }

            
            const idx = this.drag.mesh.userData.evolvingIndex;
            const scoreKey = `${this.activeTab}_${idx}`;
            const score = this.calculateScoreFromY(newCenter.y);
            this.allTabScores.set(scoreKey, score);
            this.updateSubmitButton();

            e.preventDefault();
        };

        const endDrag = (e) => {
            if (!this.drag.active) return;

            e && e.preventDefault();

            if (this.drag.mesh) {
                const box = new THREE.Box3().setFromObject(this.drag.mesh);
                const currentCenterY = box.getCenter(new THREE.Vector3()).y;
                const moved = Math.abs((this.drag.mesh.userData.dragStartCenterY ?? currentCenterY) - currentCenterY) > 0.05;
                if (moved) this.drag.mesh.userData.hasUserDragged = true;
                delete this.drag.mesh.userData.dragStartCenterY;

                // REMOVED: Stop audio on drag end - let it continue playing
                // try {
                //     this.particleSystem?.surroundController?.stopAllManualPlayback();
                // } catch (err) {
                //     console.error('Failed to stop audio after drag:', err);
                // }
            }

            this.drag.active = false;
            // Keep reference to playing mesh so we can highlight it
            // this.drag.mesh = null;  // DON'T clear the mesh yet
            this.drag.peakIndex = undefined;
            canvas.style.cursor = '';
        };

        canvas.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointerleave', endDrag);

        // Handle window resize
window.addEventListener('resize', () => {
    if (this.isEvolvingMode) {
        this.updateReferenceScalePosition();
    }
});
    }

    // Persist per-tab center Y for a mesh
    setSavedYForActiveTab(mesh, centerY) {
        const key = `${this.activeTab}_${mesh.uuid}`;
        this.savedYByTab.set(key, centerY);
    }
    getSavedYForActiveTab(mesh) {
        return this.savedYByTab.get(`${this.activeTab}_${mesh.uuid}`);
    }

     updateSubmitButton() {
        if (!this.submitButton) return;
        const total = this.allTabScores.size;
        if (total > 0) {
            this.submitButton.classList.add('enabled');
            this.submitButton.textContent = 'Generate new sounds'; // REMOVED: (${total})
        } else {
            this.submitButton.classList.remove('enabled');
            this.submitButton.textContent = 'Generate New Sounds';
        }
    }

    createSubmitButton() {
        if (this.submitButton) return; // Prevent duplicates
        const submitButton = document.createElement('button');
        submitButton.textContent = 'Submit Scores'; // REMOVED: solution count
        submitButton.className = 'evolving-submit-button';
        submitButton.addEventListener('click', () => {
            this.submitScores();
        });
        document.body.appendChild(submitButton);
        this.submitButton = submitButton;
        this.updateSubmitButton();
    }
    // Low-sensitivity score from Y:
    // - baseline (globalBaselineCenterY) maps to 0
    // - scoreArea.maxY maps to 1
    // - uses sine easing for gentler mid-range slope
    // - quantized to 0.05 steps to avoid jitter
    calculateScoreFromY(y) {
        const minY = (typeof this.globalBaselineCenterY === 'number')
            ? this.globalBaselineCenterY
            : this.scoreArea.minY;
        const maxY = this.scoreArea.maxY;

        const range = Math.max(1e-6, maxY - minY);
        const n = Math.max(0, Math.min(1, (y - minY) / range));

        
        const eased = 0.5 - 0.5 * Math.cos(Math.PI * n);

        // Quantize to reduce sensitivity
        const step = 0.05;
        const quantized = Math.round(eased / step) * step;

        // Final clamp 
        const score = Math.max(0, Math.min(1,
            this.scoreArea.minScore + quantized * (this.scoreArea.maxScore - this.scoreArea.minScore)
        ));
        return score;
    }

    // Build scores for a specific tab using current mesh center Y
    collectScoresForTab(tabId) {
        const solids = this.getSolidsByTab(tabId);
        return solids.map(m => {
            const y = this.getMeshCenterY(m);
            const score = this.calculateScoreFromY(y);
            const id = m.userData?.solution?.id ?? m.uuid;
            return { id, category: tabId, score };
        });
    }

    // Gather scores for all tabs
    collectAllTabScores() {
        const tabs = ['low', 'mid', 'high', 'rhythmic'];
        let all = [];
        tabs.forEach(tab => {
            all = all.concat(this.collectScoresForTab(tab));
        });
        return all;
    }

    // Replace getGlobalIndexForMesh with a string-id version
    getGlobalIndexForMesh(mesh) {
        const rawId = mesh?.userData?.solution?.id;
        const id = rawId != null ? String(rawId) : null;
        if (id && this.idToGlobalIndex.has(id)) return this.idToGlobalIndex.get(id);

        // Fallback: search categorized lists that carry globalIndex
        for (const cat of Object.keys(this.categoryMeshes)) {
            const entry = this.categoryMeshes[cat].find(e => String(e.solution?.id) === id);
            if (entry && Number.isInteger(entry.globalIndex)) return entry.globalIndex;
        }
        // Last resort: find in allSolutions by id
        if (id) {
            const idx = this.allSolutions.findIndex(s => String(s?.id) === id);
            if (idx >= 0) return idx;
        }
        return -1;
    }

    // Build feedback array (unopened tabs treated as baseline/unscored)
    // Replace buildFeedbackArray() so only real drags count as scored
    buildFeedbackArray() {
        const tabs = ['low', 'mid', 'high', 'rhythmic'];
        const feedback = [];
        const baseline = (typeof this.globalBaselineCenterY === 'number')
            ? this.globalBaselineCenterY
            : this.scoreArea.minY;

        tabs.forEach(tabId => {
            const solids = this.getSolidsByTab(tabId);
            solids.forEach((mesh, localIndex) => {
                const solutionId = mesh.userData?.solution?.id ?? mesh.uuid;
                const globalIndex = this.getGlobalIndexForMesh(mesh);

                const key = `${tabId}_${mesh.uuid}`;
                const hasSaved = this.savedYByTab.has(key);
                const yNow = this.getMeshCenterY(mesh);
                const yForScore = hasSaved ? this.savedYByTab.get(key) : yNow;

                // Only count as scored if the user actually dragged this item
                const was_scored = mesh.userData.hasUserDragged === true;

                // If scored, compute a gentle score from Y; otherwise 0
                const user_score = was_scored ? this.calculateScoreFromY(yForScore) : 0.0;

                feedback.push({
                    global_index: globalIndex,
                    local_index: localIndex,
                    solution_id: solutionId,
                    category: tabId,
                    was_scored,
                    user_score: Number(user_score.toFixed(3))
                });
            });
        });

        return feedback;
    }

    submitScores() {
        if (!this.pythonCommunication?.sendUserFeedback) return;

        const generation = this.pythonCommunication.getCurrentGeneration?.();
        if (generation !== undefined) {
            this.currentGeneration = generation;
        }

        if (this.submissionLocked && this.currentGeneration === this.lastSubmittedGeneration) {
            this.showSubmissionMessage('Scores of this generation already submitted', true);
            return;
        }

        // FIXED: Check if already submitting to prevent duplicate requests
        if (this._isSubmitting) {
            console.warn('⚠️ Submission already in progress, ignoring duplicate request');
            return;
        }

        // FIXED: Set submitting flag instead of global transition flag
        this._isSubmitting = true;

        const payload = {
            action: 'user_feedback',
            type: 'user_scoring',
            current_tab: this.activeTab,
            total_solutions: this.allSolutions?.length || 0,
            actually_scored_solutions: [...this.allTabScores.values()].filter(Boolean).length,
            all_solutions_included: true,
            feedback: this.buildFeedbackArray()
        };

        const ok = this.pythonCommunication.sendUserFeedback(payload);

        // FIXED: Clear submitting flag immediately after send (not after timeout)
        this._isSubmitting = false;

        if (ok === false) {
            this.showSubmissionMessage('Could not submit scores', true);
            return;
        }

        this.submissionLocked = true;
        this.lastSubmittedGeneration = this.currentGeneration;
        this.showSubmissionMessage('Scores submitted successfully, wait for new sounds to generate!');
        this.updateSubmitButton();
    }

   
    calculateSmoothedHeightFromY(y) {
        const n = Math.max(0, Math.min(1, (y - this.scoreArea.minY) / (this.scoreArea.maxY - this.scoreArea.minY)));
        return 2 + n * 10;
    }

    smoothedHeightFromY(screenY, screenH) {
        const ndc = 1.0 - (screenY / screenH) * 2.0;
        const t = (ndc + 1.0) / 2.0;
        const smoothT = t * t * (3.0 - 2.0 * t);
        return smoothT * (this.evolveLayoutTop - this.evolveLayoutBottom) + this.evolveLayoutBottom;
    }

    switchTab(tabId) {
        if (this.activeTab === tabId) return;
        
        console.log(`🔄 Switching tab from ${this.activeTab} to ${tabId}`);
        
        // CRITICAL: Stop ALL audio (not just drag state)
        try {
            this.particleSystem?.surroundController?.stopAllManualPlayback();
        } catch (e) {
            console.error('Failed to stop audio on tab switch:', e);
        }
        
        // Clear drag state
        if (this.drag) {
            this.drag.playingId = null;
            this.drag.active = false;
            this.drag.mesh = null;
        }
        
        this.activeTab = tabId;

        const tabButtons = this.tabsContainer.querySelectorAll('.evolve-tab-button');
        tabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === tabId);
        });

        if (this.isEvolvingMode) {
            this.solidMeshes.forEach(m => {
                if (m.userData.animationId) {
                    cancelAnimationFrame(m.userData.animationId);
                    m.userData.animationId = null;
                }
            });
            
            // NEW: Hide scale before transition
            if (this.scaleContainer) {
                this.scaleContainer.style.display = 'none';
            }
            
            this.transitionToEvolvingLayout();
        }
    }

    loadSolutionsFromParticleSystem() {
        console.log('Loading solutions from particle system...');

        if (this.pythonCommunication && this.pythonCommunication.getCurrentSolutions) {
            this.allSolutions = this.pythonCommunication.getCurrentSolutions();
        } else {
            this.allSolutions = this.particleSystem.currentSolutions || [];
        }
        
        this.solidMeshes = this.particleSystem.getSolids ? this.particleSystem.getSolids() : [];
        this.numSolids = this.solidMeshes.length;
        
        if (this.allSolutions.length === 0) {
            console.warn('No solutions available from particle system');
            return;
        }

        // Build id -> global index map
        this.idToGlobalIndex.clear();                       
        this.allSolutions.forEach((sol, idx) => {
            if (sol?.id != null) this.idToGlobalIndex.set(sol.id, idx);
        });

        // Clear existing category storage
        Object.keys(this.categoryMeshes).forEach(category => {
            this.categoryMeshes[category] = [];
        });

        // Categorize solutions
        this.allSolutions.forEach((solution, globalIndex) => {
            let category = solution.actual_category;
            if (typeof category === 'string') category = category.toLowerCase();

            if (['low', 'mid', 'high', 'rhythmic'].includes(category)) {
                this.categoryMeshes[category].push({ solution, globalIndex });
            }
        });
        
        console.log('Solutions categorized:', this.categoryMeshes);
    }


    restoreOriginalLayout() {
    this.animateCamera(this.originalCameraPosition.clone(), this.originalCameraTarget.clone(), 800);
    this.solidMeshes.forEach(m => {
        if (m.userData.animationId) {
            cancelAnimationFrame(m.userData.animationId);
            m.userData.animationId = null;
        }
        const orig = this.originalSolidPositions.get(m.uuid);
        if (orig) {
            m.position.copy(orig.position);
            m.rotation.copy(orig.rotation);
            m.scale.copy(orig.scale);
        }
        m.visible = true;
        delete m.userData.evolvingIndex;
        m.userData.isEvolvingFrozen = false;
        delete m.userData.evolvingTargetPosition;
        delete m.userData.evolvingAnimation;
        delete m.userData.evolvingManualY;
        delete m.userData.evolvingBaseY;
    });
}

showNoSolutionsMessage(category) {
    // Remove existing message if any
    this.hideNoSolutionsMessage();
    
    // Create message overlay
    this.noSolutionsMessage = document.createElement('div');
    this.noSolutionsMessage.className = 'no-solutions-message';
    this.noSolutionsMessage.innerHTML = `
        <div class="no-solutions-content">
            <p>No solutions in this category</p>
        </div>
    `;
    
    document.body.appendChild(this.noSolutionsMessage);
    console.log(`[Evolve] Showing no solutions message for category: ${category}`);
}

hideNoSolutionsMessage() {
    if (this.noSolutionsMessage) {
        this.noSolutionsMessage.remove();
        this.noSolutionsMessage = null;
    }
}

// In EvolvingUI.js, update handleEvolveCategoryClick (around line 250)

handleEvolveCategoryClick(categoryName, e) {
    e?.stopPropagation();
    
    console.log(`🧬 User requested evolution for category: ${categoryName}`);
    
    // Visual feedback on button (optional)
    const btn = e?.target?.closest('.evolve-category-btn');
    if (btn) {
        btn.classList.add('evolving');
        btn.textContent = 'Evolving...';
        btn.disabled = true; // Prevent multiple clicks
    }
    
    // Request evolution (will trigger onEvolutionStart callback in main.js)
    const success = this.pythonComm.requestEvolution(categoryName);
    
    if (success) {
        console.log(`✅ Evolution request sent for ${categoryName}`);
    } else {
        console.error('❌ Failed to send evolution request');
        
        // Reset button if request failed
        if (btn) {
            btn.classList.remove('evolving');
            btn.textContent = `Evolve ${categoryName}`;
            btn.disabled = false;
        }
    }
    
    // Note: Button will be reset when new generation data arrives
    // (EvolvingUI.transitionToEvolvingLayout will recreate the UI)
}

showSubmissionMessage(message, isError = false) {
    // Remove any existing message
    const existing = document.querySelector('.submission-message');
    if (existing) existing.remove();

    // Create message element using tutorial message styles
    const messageEl = document.createElement('div');
    messageEl.className = 'submission-message';
    messageEl.textContent = message;

    // Apply tutorial message overlay styles
    messageEl.style.position = 'fixed';
    messageEl.style.top = '80px';
    messageEl.style.left = '50%';
    messageEl.style.transform = 'translateX(-50%)';
    messageEl.style.zIndex = '9000';
    
    messageEl.style.fontFamily = "'Space Grotesk', sans-serif";
    messageEl.style.fontSize = '1.1rem';
    messageEl.style.fontWeight = '300';
    messageEl.style.color = isError ? '#ff6b6b' : '#53d3c0'; // Red for error, green for success
    messageEl.style.textAlign = 'center';
    messageEl.style.letterSpacing = '0.05em';
    
    messageEl.style.maxWidth = '800px';
    messageEl.style.width = '90%';
    messageEl.style.padding = '20px 40px';
    
    messageEl.style.textShadow = isError 
        ? '0 0 10px rgba(255, 107, 107, 0.3)' 
        : '0 0 10px rgba(83, 211, 192, 0.3)';
    
    messageEl.style.opacity = '0';
    messageEl.style.pointerEvents = 'none';
    messageEl.style.transition = 'opacity 0.5s ease';

    document.body.appendChild(messageEl);

    // Fade in
    requestAnimationFrame(() => {
        messageEl.style.opacity = '1';
    });

    // Auto-remove after 3 seconds
    setTimeout(() => {
        messageEl.style.opacity = '0';
        setTimeout(() => {
            if (messageEl.parentElement) {
                messageEl.remove();
            }
        }, 500);
    }, 2500);
}

// NEW: Create close button
createCloseButton() {
    this.closeBtn = document.createElement('button');
    this.closeBtn.className = 'mode-close-btn evolve-mode-close';
    this.closeBtn.innerHTML = '×';
    this.closeBtn.title = 'Exit Evolve Mode';
    this.closeBtn.style.display = 'none';
    
    this.closeBtn.onclick = () => {
        if (this.isEvolvingMode) {
            this.exitEvolvingMode();
            if (window.modeManager) {
                window.modeManager.goTo(null); // FIXED: Use goTo instead of setMode
            }
        }
    };
    
    document.body.appendChild(this.closeBtn);
}}