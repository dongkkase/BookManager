const Module = require('node:module');

const electronPackageExport = require(require.resolve('electron'));
const originalLoad = Module._load;

Module._load = function loadTestModule(request, parent, isMain) {
    if (request === 'electron') return electronPackageExport;
    return Reflect.apply(originalLoad, this, [request, parent, isMain]);
};
