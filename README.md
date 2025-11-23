# Sound Particle Visualization

This project is a 3D visualization of sound particles. Currently, it uses fake audio data for testing purposes. Future updates will integrate real audio data from a backend.

## Project Structure

- **src/**: Contains the source code for the application.
  - **index.html**: Main HTML entry point.
  - **main.js**: Initializes the Three.js scene and integrates components.
  - **styles.css**: CSS styles for the application.
  - **components/**: Contains the main components of the visualization.
    - **ParticleSystem.js**: Manages particle creation and animation.
    - **AudioVisualizer.js**: Handles audio playback and visual representation.
    - **BlockMapper.js**: Maps particle positions to 3D blocks.
  - **utils/**: Utility functions for common tasks.
    - **helpers.js**: Functions for loading textures and managing audio.

- **assets/**: Contains audio and texture assets.
  - **audio/**: Example audio files for testing.
    - **sample-audio.mp3**: Sample audio file.
  - **textures/**: Texture images for the 3D blocks.
    - **block-texture.jpg**: Texture for the blocks.

- **package.json**: Configuration file for npm, listing dependencies and scripts.
- **webpack.config.js**: Configuration file for Webpack, specifying how to bundle the application.

## Setup Instructions

1. Clone the repository:
   ```
   git clone <repository-url>
   cd sound-particle-visualization
   ```

2. Install the dependencies:
   ```
   npm install
   ```

3. Run the application:
   ```
   npm start
   ```

4. Open your browser and navigate to `http://localhost:9000` to view the visualization.

## Usage Guidelines

- The application visualizes sound particles based on audio synthesis parameters.
- Adjust the audio parameters to see how they affect the particle visualization.
- Explore the architectural metaphor created by the 3D blocks representing the particles.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.