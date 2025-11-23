export class Button {
    constructor(text, position, onClick) {
        this.text = text;
        this.position = position;
        this.onClick = onClick;
        this.button = null;
        this.isSelected = false;
        
        this.createButton();
    }
    
    createButton() {
        const existingBtn = document.getElementById(`${this.text.toLowerCase()}-btn`);
        if (existingBtn) {
            this.button = existingBtn;
            this.button.onclick = this.handleClick.bind(this);
            return;
        }
        
        this.button = document.createElement('button');
        this.button.id = `${this.text.toLowerCase()}-btn`;
        this.button.className = 'main-screen-btn';
        
        // Wrap text in a span for the animation
        const textSpan = document.createElement('span');
        textSpan.className = 'button-text';
        textSpan.innerText = this.text.toUpperCase();
        this.button.appendChild(textSpan);
        
        this.button.onclick = this.handleClick.bind(this);
        
        this.addToContainer();
    }
    
    // Handle click to toggle selection and call original onClick
    handleClick() {
        // DON'T call this.onClick() here anymore - let main.js handle it
        // this.onClick();  // <-- REMOVE THIS LINE
        
        // Just manage menu closing
        setTimeout(() => {
            const isSaveModeActive = document.querySelector('#save-btn .button-text')?.innerText === 'EXIT SAVE';
            if (!isSaveModeActive) {
                this.closeHamburgerMenu();
            }
        }, 100);
    }
    
    closeHamburgerMenu() {
        const hamburgerButton = document.querySelector('.hamburger-button');
        const optionsContainer = document.querySelector('.hamburger-options');
        
        if (hamburgerButton && optionsContainer) {
            hamburgerButton.classList.remove('open');
            optionsContainer.classList.remove('open');
        }
    }
    
    addToContainer() {
        if (!window.navigationContainers) return;
        
        // All buttons now go to the hamburger menu instead of corners
        const container = window.navigationContainers.hamburgerMenu || document.body;
        container.appendChild(this.button);
    }
    
    // Set selected state 
    setSelected(selected = true) {
        this.isSelected = selected;
        if (selected) {
            this.button.classList.add('selected');
        } else {
            this.button.classList.remove('selected', 'show-underline-delayed');
        }
    }
    
    // Smooth text change with animation
    changeText(newText) {
        const textSpan = this.button.querySelector('.button-text');
        if (textSpan.innerText === newText.toUpperCase()) return;

        // Convert old span to .old
        textSpan.className = 'button-text old';

        // Create new span as .new
        const newSpan = document.createElement('span');
        newSpan.className = 'button-text new';
        newSpan.innerText = newText.toUpperCase();

        this.button.appendChild(newSpan);

        // Force reflow for transition
        this.button.offsetHeight;

        // Trigger transition
        this.button.classList.add('text-changing');

        // Clean up after transition
        setTimeout(() => {
            this.button.classList.remove('text-changing');
            textSpan.remove();
            newSpan.className = 'button-text';
        }, 1400); 
    }
    
    hide() {
        if (this.button) {
            this.button.classList.add('hidden');
        }
    }
    
    show() {
        if (this.button) {
            this.button.classList.remove('hidden');
        }
    }
    
    remove() {
        if (this.button) {
            this.button.remove();
        }
    }
}