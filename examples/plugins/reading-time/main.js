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
    let disposePanel = () => {};
    const refresh = () => {
      disposePanel();
      const minutes = Math.max(1, Math.ceil(context.editor.getText().replace(/\s/g, '').length / 350));
      disposePanel = context.registerHtmlPanel('reading-time', '阅读时间', `<p>约 ${minutes} 分钟</p>`);
    };
    refresh();
    context.onEvent('file:opened', refresh);
    context.onEvent('file:changed', refresh);
    context.register(() => disposePanel());
    context.addMenuItem('estimate-menu', '估算阅读时间', 'estimate');
    context.addToolbarItem('estimate-toolbar', '阅读时间', 'estimate');
  }
}
