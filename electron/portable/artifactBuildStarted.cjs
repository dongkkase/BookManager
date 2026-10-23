module.exports = function artifactBuildStarted(context) {
    if (context.targetPresentableName !== 'portable') return;

    // This artifact hook also runs for direct CLI and prepackaged builds.
    require('./builderAdapter.cjs').installPortableBuilderAdapter();
};
