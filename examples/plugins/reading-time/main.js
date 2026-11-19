export default class ReadingTime {
  onload(context) {
    context.addCommand({
      id: 'estimate',
      name: '阅读时间：估算当前文档',
      run() {
        const text = context.editor.getText();
        const characters = text.replace(/\s/g, '').length;
        context.notice(`预计阅读 ${Math.max(1, Math.ceil(characters / 350))} 分钟`);
      },
    });
    context.registerPanel('reading-time', '阅读时间', element => {
      element.textContent = `约 ${Math.max(1, Math.ceil(context.editor.getText().replace(/\s/g, '').length / 350))} 分钟`;
    });
  }
}
