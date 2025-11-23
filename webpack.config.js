const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
    mode: isProduction ? 'production' : 'development',
    entry: './src/main.js',
    output: {
        filename: isProduction ? '[name].[contenthash].js' : '[name].js',
        path: path.resolve(__dirname, 'dist'),
        clean: true,
        chunkFilename: isProduction ? '[name].[contenthash].chunk.js' : '[name].chunk.js',
        // FIXED: Match your actual GitHub Pages repository name
        publicPath: isProduction ? '/Shard_Frotend/' : '/',
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
                        cacheDirectory: true,
                    }
                }
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            },
            {
                test: /\.(png|jpg|gif|mp3|svg|ico)$/,
                type: 'asset/resource',
                generator: {
                    filename: 'assets/[name].[hash][ext]',
                },
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './index.html',
            favicon: './public/Shard.ico'
        }),
    ],
    devServer: {
        static: {
            directory: path.resolve(__dirname, 'public'),
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
        maxAssetSize: 1000000,
        maxEntrypointSize: 1000000,
        hints: isProduction ? 'warning' : false,
    },
    cache: {
        type: 'filesystem',
    },
};