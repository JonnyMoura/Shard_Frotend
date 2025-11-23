export class Tutorial {
    constructor(container = document.body) {
        this.container = container;
        this.messages = [
            "Welcome to Shard",
            "The sounds are represented by the crystals you see on the screen",
            "To start playing the various sounds click on the button on the right",
            "On the Save mode you can store the sounds you like or combinations of them and access them on the Library",
            "On the Evolve tab you can score which sounds you like more according to their category",
            "Then click submit to send your scores and generate a new collection of sounds",
            "Have fun!"
        ];
        this.currentIndex = 0;
        this.messageElement = null;
        this.isShowing = false;
        this.timeoutId = null;
    }

    show() {
        if (this.isShowing) return;
        this.isShowing = true;
        this.currentIndex = 0;
        this.showCurrentMessage();
    }

    showCurrentMessage() {
        if (this.messageElement?.parentElement) {
            this.messageElement.remove();
        }

        this.messageElement = document.createElement('div');
        this.messageElement.className = 'tutorial-message-overlay';
        this.messageElement.textContent = this.messages[this.currentIndex];
        this.container.appendChild(this.messageElement);

        requestAnimationFrame(() => {
            this.messageElement.classList.add('visible');
        });

        clearTimeout(this.timeoutId);
        this.timeoutId = setTimeout(() => this.next(), 4000);

        const clickHandler = () => {
            clearTimeout(this.timeoutId);
            this.next();
            this.messageElement?.removeEventListener('click', clickHandler);
        };
        this.messageElement.addEventListener('click', clickHandler);
    }

    next() {
        if (!this.messageElement) return;

        this.messageElement.classList.remove('visible');

        setTimeout(() => {
            if (this.currentIndex < this.messages.length - 1) {
                this.currentIndex += 1;
                this.showCurrentMessage();
            } else {
                this.hide();
            }
        }, 300);
    }

    hide() {
        if (!this.isShowing) return;

        clearTimeout(this.timeoutId);

        if (this.messageElement?.parentElement) {
            this.messageElement.classList.remove('visible');
            setTimeout(() => this.messageElement?.remove(), 300);
        }

        this.isShowing = false;
    }
}