import * as THREE from 'three';



export class PythonCommunication {
    constructor(particleSystem, onGenerationData = null, onConnectionReady = null, onRegenerationStart = null) {
        console.log('🐍 Initializing Python Communication...');
        this.particleSystem = particleSystem;
        this.websocket = null;
        this.currentGeneration = null;
        this.currentSolutions = [];
        this.connectionStatus = 'connecting';
        this.onGenerationData = onGenerationData;
        this.onConnectionReady = onConnectionReady;
        this.onRegenerationStart = onRegenerationStart;
        this.dataReceived = false;
        this._lastFeedbackTime = 0; // FIXED: Initialize to 0 instead of null

        this.connectToPython();

        this.connectionCheckInterval = setInterval(() => {
            this.logConnectionStatus();
        }, 5000);
    }

    logConnectionStatus() {
        console.log('🔍 Connection Status Check:');
        console.log('  - WebSocket exists:', !!this.websocket);
        console.log('  - WebSocket state:', this.websocket ? this.websocket.readyState : 'N/A');
        console.log('  - Current status:', this.connectionStatus);
        console.log('  - Solutions received:', this.currentSolutions.length);
    }

    connectToPython() {
        try {
            console.log('🐍 Attempting to connect to Python WebSocket server at ws://localhost:8765');
            this.websocket = new WebSocket('ws://bjxjd-2001-8a0-fff6-4000-6183-59dd-5abf-6bb4.a.free.pinggy.link');
            
            this.websocket.onopen = () => {
                console.log('✅ Connected to Python evolution engine');
                this.updateConnectionStatus('connected');
            };
            
            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('📨 Message received:', data.type, `Generation ${data.generation}`);
                    this.handlePythonMessage(data);
                } catch (error) {
                    console.error('❌ Failed to parse JSON message:', error);
                }
            };
            
            this.websocket.onclose = (event) => {
                console.log('🐍 WebSocket connection closed');
                this.updateConnectionStatus('disconnected');
                setTimeout(() => this.connectToPython(), 3000);
            };
            
            this.websocket.onerror = (error) => {
                console.error('🐍 WebSocket error:', error);
                this.updateConnectionStatus('error');
            };
        } catch (error) {
            console.error('🐍 Failed to create WebSocket connection:', error);
            this.updateConnectionStatus('error');
        }
    }

    handlePythonMessage(data) {
        switch(data.type) {
            case 'generation_data':
                this.handleGenerationData(data);
                break;
            case 'evolution_complete':
                this.handleEvolutionComplete(data);
                break;
            case 'error':
                console.error('🐍 Python error:', data.message);
                break;
        }
    }

    handleGenerationData(data) {
        console.log(`🧬 Processing generation ${data.generation} with ${data.solutions?.length || 0} solutions`);
        
        // Validate data
        if (!data.solutions || !Array.isArray(data.solutions) || data.solutions.length === 0) {
            console.error('❌ Invalid generation data - no solutions:', data);
            return;
        }

        // FIXED: Add generation number to each solution for unique identification
        data.solutions = data.solutions.map(sol => ({
            ...sol,
            generation: data.generation
        }));

        // NEW: Force exit to main scene before processing new generation
        const modeManager = window.modeManager;
        if (modeManager) {
            const isInMode = modeManager.isActive('save') || 
                            modeManager.isActive('evolve') || 
                            modeManager.isActive('library');
            
            if (isInMode) {
                console.log('⚠️ New generation arrived while in mode - forcing exit to main scene');
                
                // Force exit all modes synchronously
                try {
                    if (modeManager.save?.isSaveMode) {
                        modeManager.save.forceReset?.({ restoreMaterials: true });
                        modeManager.save.exitSaveMode?.();
                    }
                    if (modeManager.evolve?.isEvolvingMode) {
                        modeManager.evolve.exitEvolvingMode?.();
                    }
                    if (modeManager.library?.inSpace) {
                        modeManager.library.exitSpace?.();
                    }
                    
                    // Clear audio and normalize to main
                    modeManager._closeToMain?.();
                } catch (err) {
                    console.error('Failed to exit modes:', err);
                }
                
                // Wait a frame to ensure cleanup completes
                setTimeout(() => {
                    this._processGenerationData(data);
                }, 100);
                return;
            }
        }
        
        // Process immediately if already in main scene
        this._processGenerationData(data);
    }

    // NEW: Separate method for actual data processing
    _processGenerationData(data) {
        // CRITICAL: Reset click tracking for new generation
        if (window.lastClickedSolidId !== undefined) {
            console.log('🔄 Resetting click tracking for new generation');
            window.lastClickedSolidId = null;
        }
        
        this.currentGeneration = data;
        this.currentSolutions = data.solutions;
        this.dataReceived = true;
        
        console.log('✅ Generation data validated:', {
            generation: data.generation,
            solutionCount: data.solutions.length,
            firstSolution: data.solutions[0]
        });

        // NEW: Notify that regeneration is starting (show loading screen)
        if (typeof this.onRegenerationStart === 'function') {
            this.onRegenerationStart(data);
        }

        // Update visuals
        this.updateSolidsFromGeneration(data);

        // Notify callback (audio system) - will hide loading screen after audio loads
        if (typeof this.onGenerationData === 'function') {
            console.log('📢 Calling onGenerationData callback...');
            this.onGenerationData(data);
        }
    }

    updateSolidsFromGeneration(generationData) {
        const solutions = generationData.solutions;
        console.log(`🎨 Updating ${solutions.length} solids from generation data`);
        this.currentSolutions = solutions;
        this.particleSystem.regenerateWithSolutions(solutions);
    }

    updateConnectionStatus(status) {
        this.connectionStatus = status;
        console.log(`🔌 Connection status: ${status}`);
    }

    // **UTILITY METHODS (keep existing)**
    getCurrentGeneration() { return this.currentGeneration; }
    getCurrentSolutions() { return this.currentSolutions; }
    getSolutionById(id) { return this.currentSolutions.find(solution => solution.id === id); }
    getSolutionByIndex(index) { return this.currentSolutions[index] || null; }
    isConnected() { 
        return this.connectionStatus === 'connected' && 
               this.websocket && 
               this.websocket.readyState === WebSocket.OPEN; 
    }

    sendUserFeedback(feedbackData) {
        if (!this.isConnected()) {
            console.warn('⚠️ WS not connected. Skipping sendUserFeedback.');
            return false;
        }
        
        // REMOVED: window.__modeTransitioning check (handled in EvolvingUI instead)
        
        // Check if this is a duplicate request (within 500ms)
        const now = Date.now();
        if (this._lastFeedbackTime && (now - this._lastFeedbackTime) < 500) {
            console.warn('⚠️ Skipping duplicate feedback request (last: ' + (now - this._lastFeedbackTime) + 'ms ago)');
            return false;
        }
        
        // Validate feedback data
        if (!feedbackData || typeof feedbackData !== 'object') {
            console.error('❌ Invalid feedback data:', feedbackData);
            return false;
        }
        
        // CRITICAL: Check if this is actually a feedback action (not a random button click)
        if (feedbackData.action !== 'user_feedback') {
            console.warn('⚠️ Invalid action in feedback data:', feedbackData.action);
            return false;
        }
        
        this._lastFeedbackTime = now;
        
        const payload = {
            action: 'user_feedback',
            ...feedbackData,
            timestamp: now
        };
        
        try {
            const json = JSON.stringify(payload);
            console.log('➡️ WS SEND user_feedback:', payload);
            this.websocket.send(json);
            return true;
        } catch (err) {
            console.error('❌ Failed to serialize feedback payload:', err, feedbackData);
            return false;
        }
    }

    requestEvolution(category) {
        if (!this.isConnected()) return false;
        this.websocket.send(JSON.stringify({
            action: 'evolve_generation',
            category: category,
            generation: this.currentGeneration?.generation || 0,
            timestamp: Date.now()
        }));
        return true;
    }
}