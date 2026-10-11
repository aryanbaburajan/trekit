'use client';

import { useEffect } from 'react';

export default function ExplorerPage() {
  useEffect(() => {
    import('../src/main.js');
  }, []);

  return <div id="app" />;
}
