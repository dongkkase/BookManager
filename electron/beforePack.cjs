const { buildMacCursorCompat } = require('./buildMacCursorCompat.cjs');

module.exports = function beforePack(context) {
    if (context.electronPlatformName !== 'darwin') return;
    const projectRoot = context.packager?.projectDir
        || context.packager?.info?.projectDir
        || process.cwd();
    const result = buildMacCursorCompat({ projectRoot });
    if (result.skipped) throw new Error(result.reason);
};
