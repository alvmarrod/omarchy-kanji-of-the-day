import QtQuick
import qs.Commons

// Japanese text with true furigana, built from a wrapped Flow of ruby units.
// Qt's rich text has no <ruby> support, so each unit puts a small reading above
// its base; plain units simply leave the reading line empty.
Flow {
  id: root
  property var units: []
  property string fontFamily: Style.font.family
  property real baseSize: Style.font.body
  property color textColor: Color.foreground
  property color readingColor: Qt.darker(textColor, 1.6)
  property real gap: Math.max(1, Style.space(1))

  readonly property int readingSize: Math.max(7, Math.round(baseSize * 0.55))
  readonly property int readingHeight: Math.round(readingSize * 1.35)
  readonly property int lineHeight: readingHeight + gap + Math.round(baseSize * 1.25)

  width: parent ? parent.width : implicitWidth
  height: implicitHeight
  spacing: 0

  Repeater {
    model: root.units

    Item {
      id: unit
      required property var modelData
      width: Math.max(baseMetrics.advanceWidth, readingMetrics.advanceWidth)
      height: root.lineHeight

      TextMetrics {
        id: baseMetrics
        font.family: root.fontFamily
        font.pixelSize: root.baseSize
        text: unit.modelData.base || ""
      }

      TextMetrics {
        id: readingMetrics
        font.family: root.fontFamily
        font.pixelSize: root.readingSize
        text: unit.modelData.reading || ""
      }

      Text {
        id: reading
        visible: (unit.modelData.reading || "") !== ""
        text: unit.modelData.reading || ""
        width: parent.width
        height: root.readingHeight
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignBottom
        color: root.readingColor
        font.family: root.fontFamily
        font.pixelSize: root.readingSize
      }

      Text {
        id: base
        y: root.readingHeight + root.gap
        anchors.horizontalCenter: parent.horizontalCenter
        textFormat: Text.PlainText
        text: unit.modelData.base || ""
        color: root.textColor
        font.family: root.fontFamily
        font.pixelSize: root.baseSize
      }
    }
  }
}
