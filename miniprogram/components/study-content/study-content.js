const { formatBlocks } = require('./format');

Component({
  properties: { content: { type: String, value: '' } },
  data: { blocks: [] },
  observers: {
    content(value) { this.setData({ blocks: formatBlocks(value) }); },
  },
});
