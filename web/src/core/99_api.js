// ---- the public object. Keys are the Python function names, so tests/vectors.json can name
// one function for both languages.
const CORE = Object.freeze({
  PRODUCT_NAME, SUITE_NUMBER, BACKUP_FORMAT, BACKUP_VERSION, PACKET_FORMAT, PACKET_VERSION, FIELD_TABLES, KINDS, LABELS, REPORTS,
  JOB_STATES, RULES, RULE_TITLES, SWITCH, LIST_KINDS, BUCKETS, PAY_NAMES, DAY_ABBR, MONTHS, EXAMPLE_BOOK, ServiceError, Tx, STEPS,
  // util
  div_round: divRound, mul_div: mulDiv, allocate, add_days: addDays, add_months: addMonths, days_between: daysBetween,
  weekday, week_start: weekStart, month_end: monthEnd, month_start: monthStart, day_num: dayNum, day_str: dayStr,
  parse_date: parseDate, parse_time: parseTime, time_str: timeStr, parse_stamp: parseStamp, stamp_local: stampLocal,
  elapsed_minutes: elapsedMinutes, cents_text: centsText, money, milli_text: milliText, pct_text: pctText,
  parse_money: parseMoney, parse_milli: parseMilli, clean_text: cleanText, to_csv: toCsv, parse_csv: parseCsv,
  esc_html: escHtml, strip, squash, lower, show, deep_equal: deepEqual,
  // schema and book
  check_record: checkRecord, validate_book: validateBook, validate_refs: validateRefs, blank_book: blankBook,
  export_backup: exportBackup, import_backup: importBackup, parse_json: parseJson, apply, apply_all: applyAll,
  update_settings: updateSettings,
  // money
  doc_totals: docTotals, line_amount: lineAmount, invoice_state: invoiceState, quote_state: quoteState,
  client_balance: clientBalance, due_date: dueDate,
  // schedule
  occurrences, describe_rule: describeRule, nth_weekday: nthWeekday, plan_visits: planVisits, find_conflicts: findConflicts,
  distance_m: distanceM, route_order: routeOrder, suggest_route: suggestRoute, apply_route: applyRoute, crew_day: crewDay,
  day_stops: dayStops,
  // workflow
  do: doStep, job_state: jobState, visit_minutes: visitMinutes,
  // automation
  run_automations: runAutomations, undo_automation: undoAutomation, trim_log: trimLog,
  // reports
  revenue_by_month: revenueByMonth, jobs_by_status: jobsByStatus, quote_conversion: quoteConversion, crew_hours: crewHours,
  job_profitability: jobProfitability, job_costs: jobCosts, aging, overview, months_between: monthsBetween,
  // exports, payment links, QR, messages
  list_csv: listCsv, lines_csv: linesCsv, report_csv: reportCsv, crossfoot_iif: crossfootIif,
  crossfoot_customers_csv: crossfootCustomersCsv, customer_names: customerNames, client_page: clientPage,
  payment_option: paymentOption, payment_options: paymentOptions, check_link: checkLink, qr_matrix: qrMatrix, qr_svg: qrSvg,
  date_words: dateWords, time_words: timeWords, hm, address_line: addressLine,
  // packets and imports
  export_packet: exportPacket, read_packet: readPacket, crew_update: crewUpdate, merge_preview: mergePreview,
  apply_packet: applyPacket, return_packet: returnPacket, import_clients_csv: importClientsCsv,
});
