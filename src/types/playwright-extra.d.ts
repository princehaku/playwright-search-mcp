declare module 'playwright-extra/dist/plugins/stealth/index.js' {
    import { PlaywrightPlugin } from 'playwright-extra';
    const plugin: () => PlaywrightPlugin;
    export default plugin;
}
