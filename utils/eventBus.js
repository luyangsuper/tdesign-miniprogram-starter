export default function createBus() {
  return {
    events: {},
    on(event, callback) {
      if (!this.events[event]) this.events[event] = [];
      this.events[event].push(callback);
    },
    off(event, callback) {
      if (!this.events[event]) return;
      if (!callback) this.events[event] = [];
      else {
        const index = this.events[event].indexOf(callback);
        if (index !== -1) this.events[event].splice(index, 1);
      }
    },
    emit(event, ...args) {
      if (!this.events[event]) return;
      /* 单个监听器抛错不能挡住后面的监听器（否则关了开关只有部分 UI 更新） */
      this.events[event].slice().forEach((callback) => {
        try {
          callback(...args);
        } catch (e) {
          /* ignore */
        }
      });
    },
  };
}
