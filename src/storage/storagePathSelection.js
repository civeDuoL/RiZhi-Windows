const path = require('path');

function resolveSelectedMemoryRoot(selectedDirectory) {
  const selected = path.resolve(selectedDirectory);
  const name = path.basename(selected).toLowerCase();
  const parentName = path.basename(path.dirname(selected)).toLowerCase();
  if (name === 'memory' && parentName === 'rizhi') return selected;
  if (name === 'rizhi') return path.join(selected, 'memory');
  return path.join(selected, 'rizhi', 'memory');
}

module.exports = { resolveSelectedMemoryRoot };
