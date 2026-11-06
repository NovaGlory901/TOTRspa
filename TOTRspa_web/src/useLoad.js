import { useEffect, useState } from 'react';

// Runs an API call when the inputs change; returns { data, error }.
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    let live = true;
    setState({ data: null, error: '' });
    fn().then(
      data => live && setState({ data, error: '' }),
      err => live && setState({ data: null, error: err.message }),
    );
    return () => {
      live = false;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
