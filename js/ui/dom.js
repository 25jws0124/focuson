/* =====================================================================
 * FocusOn — ui/dom.js
 * 화면 요소 참조. id 로 잡는 곳은 여기 한 곳뿐이다.
 * ===================================================================== */

/* ------------------------------------------------------------- 요소 */
export const $ = (id) => document.getElementById(id);
export const el = {
  video: $('cam'), overlay: $('overlay'), camHint: $('camHint'),
  calibBox: $('calibBox'), calibNum: $('calibNum'), calibBar: $('calibBar'),
  btnCalib: $('btnCalib'), btnStart: $('btnStart'), btnStop: $('btnStop'),
  status: $('status'), engineBadge: $('engineBadge'),
  ringFill: $('ringFill'), scoreNum: $('scoreNum'), stateChip: $('stateChip'),
  confFlash: $('confFlash'),
  barHead: $('barHead'), barGaze: $('barGaze'), barEyes: $('barEyes'),
  valHead: $('valHead'), valGaze: $('valGaze'), valEyes: $('valEyes'),
  mini: $('miniTimeline'), miniMeta: $('miniMeta'),
  report: $('report'), reportChart: $('reportChart'),
  kpiRatio: $('kpiRatio'), kpiDur: $('kpiDur'), kpiAvg: $('kpiAvg'), kpiConf: $('kpiConf'),
  segList: $('segList'), confList: $('confList'),
  btnJson: $('btnJson'), btnAgain: $('btnAgain'),
  confReview: $('confReview'), confGrid: $('confGrid'),
  parentEmail: $('parentEmail'), btnSendParentReport: $('btnSendParentReport'),
  parentReportStatus: $('parentReportStatus'),
  battle: $('battle'), parentReportBox: $('parentReportBox'),
  miniTitle: $('miniTitle'), confReviewHint: $('confReviewHint'),
  battleEntry: $('battleEntry'), btnBattleCreate: $('btnBattleCreate'),
  battleCodeInput: $('battleCodeInput'), btnBattleJoin: $('btnBattleJoin'),
  battleEntryStatus: $('battleEntryStatus'),
  battleRoom: $('battleRoom'), battleCodeDisplay: $('battleCodeDisplay'),
  battleWaiting: $('battleWaiting'), battleVs: $('battleVs'),
  battleMyScore: $('battleMyScore'), battleMyChip: $('battleMyChip'),
  battleOppScore: $('battleOppScore'), battleOppChip: $('battleOppChip'),
};
