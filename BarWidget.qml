import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui

// Compact bar entry: "KotD: <kanji>". The panel owns fetching and state, so
// this only reads the label it exposes and keeps the same open/close/opened
// contract as the other bar widgets.
BarWidget {
  id: root
  moduleName: "io.github.alvmarrod.kanji-of-the-day"

  readonly property var panel: panelLoader.item
  readonly property string barText: panel ? panel.barText : "KotD: …"

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  function refresh() {
    if (panel && panel.refresh) panel.refresh()
  }

  function open() {
    if (panel && panel.open) panel.open()
  }

  function close() {
    if (panel && panel.close) panel.close()
  }

  function togglePanel() {
    if (panel && panel.toggle) panel.toggle()
  }

  readonly property bool opened: panel ? panel.opened === true : false
  readonly property bool popoutSwitchClosing: panel ? panel.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panel) panel.closeForPopoutSwitch()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "io.github.alvmarrod.kanji-of-the-day"

    function refresh(): void { root.broadcast("refresh") }
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.barText
    labelVisible: true
    hasVisualContent: true
    tooltipText: ""
    onPressed: function(mouseButton) {
      if (mouseButton === Qt.MiddleButton) root.refresh()
      else root.togglePanel()
    }
  }
}
