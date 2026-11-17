const { haptic } = require('../../utils/ui');

Component({
  properties: {
    checked: {
      type: Boolean,
      value: false,
    },
    disabled: {
      type: Boolean,
      value: false,
    },
    reduceTransparency: {
      type: Boolean,
      value: false,
    },
    passive: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    pressing: false,
  },

  methods: {
    onTouchStart() {
      if (this.data.disabled) return;
      this.setData({ pressing: true });
    },

    onTouchEnd() {
      if (this.data.pressing) {
        this.setData({ pressing: false });
      }
    },

    onTap() {
      if (this.data.disabled || this.data.passive) return;
      const nextValue = !this.data.checked;
      haptic('light');
      this.triggerEvent('change', { value: nextValue });
    },
  },
});
