// Add this helper class at the top of ParticleSystem.js (before the ParticleSystem class)

export class SpatialGrid {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.grid = new Map();
    }

    _hash(x, z) {
        const cx = Math.floor(x / this.cellSize);
        const cz = Math.floor(z / this.cellSize);
        return `${cx},${cz}`;
    }

    clear() {
        this.grid.clear();
    }

    insert(index, position) {
        const key = this._hash(position.x, position.z);
        if (!this.grid.has(key)) {
            this.grid.set(key, []);
        }
        this.grid.get(key).push(index);
    }

    getNearby(position, radius) {
        const nearby = [];
        const cells = Math.ceil(radius / this.cellSize);
        const cx = Math.floor(position.x / this.cellSize);
        const cz = Math.floor(position.z / this.cellSize);

        // Check neighboring cells
        for (let dx = -cells; dx <= cells; dx++) {
            for (let dz = -cells; dz <= cells; dz++) {
                const key = `${cx + dx},${cz + dz}`;
                const cell = this.grid.get(key);
                if (cell) {
                    nearby.push(...cell);
                }
            }
        }
        return nearby;
    }
}

export default SpatialGrid;