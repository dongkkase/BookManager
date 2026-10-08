const operationErrors = new WeakMap();

export function attachOperationErrors(result, errors) {
    if (result && typeof result === 'object' && Array.isArray(errors)) {
        operationErrors.set(result, errors.filter(error => error && typeof error === 'object'));
    }
    return result;
}

export function getOperationErrors(result) {
    return operationErrors.get(result) || [];
}
