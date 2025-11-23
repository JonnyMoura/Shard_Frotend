export class LoadingScreen {
    constructor() {
        this.container = null;
        this.isVisible = false;
    }

    show(message = 'Loading') {
        if (this.isVisible) return;
        
        // Remove any existing loading screen
        this.hide();

        // Create loading container
        this.container = document.createElement('div');
        this.container.className = 'loading-screen';
        
        // Create content
        const content = document.createElement('div');
        content.className = 'loading-content';
        
        // Create animated text
        const text = document.createElement('div');
        text.className = 'loading-text';
        text.textContent = message;
        
        // Create animated dots
        const dots = document.createElement('span');
        dots.className = 'loading-dots';
        text.appendChild(dots);
        
        content.appendChild(text);
        this.container.appendChild(content);
        document.body.appendChild(this.container);
        
        this.isVisible = true;
        
        // Animate dots
        this.animateDots();
        
        console.log(`🔄 Loading screen shown: "${message}"`);
    }

    hide() {
        if (this.container) {
            this.container.classList.add('fade-out');
            setTimeout(() => {
                if (this.container && this.container.parentElement) {
                    this.container.remove();
                }
                this.container = null;
                this.isVisible = false;
            }, 500); // Match CSS transition
            console.log('✅ Loading screen hidden');
        }
    }

    updateMessage(message) {
        if (this.container) {
            const textEl = this.container.querySelector('.loading-text');
            if (textEl) {
                // Preserve dots element
                const dots = textEl.querySelector('.loading-dots');
                textEl.textContent = message;
                if (dots) textEl.appendChild(dots);
            }
        }
    }

    animateDots() {
        if (!this.container) return;
        
        const dots = this.container.querySelector('.loading-dots');
        if (!dots) return;
        
        let dotCount = 0;
        const interval = setInterval(() => {
            if (!this.isVisible || !this.container) {
                clearInterval(interval);
                return;
            }
            
            dotCount = (dotCount + 1) % 4;
            dots.textContent = '.'.repeat(dotCount);
        }, 500);
    }
}