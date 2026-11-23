/** Controls overlapping PDF downloads without coupling them to unrelated saves.
 * Closing a reader invalidates all pending results; each new request aborts the old one.
 */
export function createPdfRequestGate() {
  let generation=0;
  let pending:AbortController|null=null;
  return {
    begin() {
      pending?.abort();
      const controller=new AbortController();
      pending=controller;
      return {requestId:++generation,controller};
    },
    isCurrent(requestId:number) {return requestId===generation;},
    release(requestId:number,controller:AbortController) {
      if(requestId===generation&&pending===controller)pending=null;
    },
    cancel() {
      ++generation;
      pending?.abort();
      pending=null;
    },
  };
}
