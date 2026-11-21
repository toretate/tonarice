export function isLmStudioToolUseEnabled(disabledModels: readonly string[], model: string): boolean {
    return !disabledModels.includes(model.trim());
}

export function setLmStudioToolUseEnabled(disabledModels: readonly string[], model: string, enabled: boolean): string[] {
    const key = model.trim();
    if (!key) return [...disabledModels];
    const remaining = disabledModels.filter(item => item !== key);
    return enabled ? remaining : [...remaining, key];
}
