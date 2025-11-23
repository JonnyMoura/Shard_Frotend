const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
    mode: isProduction ? 'production' : 'development',
    entry: './src/main.js',
    output: {
        filename: isProduction ? '[name].[contenthash].js' : '[name].js',
        path: path.resolve(__dirname, 'dist'),
        clean: true, // Clean dist folder before each build
        chunkFilename: isProduction ? '[name].[contenthash].chunk.js' : '[name].chunk.js',
    },
    optimization: {
        splitChunks: {
            chunks: 'all',
            cacheGroups: {
                vendor: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendors',
                    priority: 10,
                    enforce: true,
                },
                three: {
                    test: /[\\/]node_modules[\\/]three[\\/]/,
                    name: 'three',
                    priority: 20,
                    enforce: true,
                },
                components: {
                    test: /[\\/]src[\\/]components[\\/]/,
                    name: 'components',
                    priority: 5,
                    minChunks: 1,
                },
            },
        },
        runtimeChunk: 'single',
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env'],
                        cacheDirectory: true, // Enable babel caching
                    }
                }
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            },
            {
                test: /\.(png|jpg|gif|mp3)$/,
                type: 'asset/resource', // Use webpack 5 asset modules instead of file-loader
                generator: {
                    filename: 'assets/[name].[hash][ext]',
                },
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './index.html', // Path to your index.html
        }),
    ],
    devServer: {
        static: {
            directory: path.resolve(__dirname, 'public'), // Serve static files from 'public'
        },
        compress: true,
        port: 9000,
        client: {
            webSocketURL: 'ws://localhost:9000/ws',
        },
    },
    resolve: {
        extensions: ['.js'],
    },
    performance: {
        maxAssetSize: 1000000, // 1MB - increased for Three.js
        maxEntrypointSize: 1000000, // 1MB
        hints: isProduction ? 'warning' : false, // Only show warnings in production
    },
    cache: {
        type: 'filesystem', // Enable persistent caching for faster rebuilds
    },
};