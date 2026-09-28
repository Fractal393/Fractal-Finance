import { describe, it, expect } from 'vitest';
import { App } from './app';

describe('App', () => {
  it('should instantiate the root app component', () => {
    const app = new App();
    expect(app).toBeDefined();
    expect(app).toBeInstanceOf(App);
  });
});
