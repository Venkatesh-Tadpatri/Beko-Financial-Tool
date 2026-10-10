import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy*/waitFor give up after 1 s by default; on a busy machine screens can take longer to settle.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());
