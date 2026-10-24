import pytest

from fieldservice.util import (ServiceError, add_days, add_months, allocate, cents_text, clean_text, days_between,
                               div_round, elapsed_minutes, milli_text, money, mul_div, parse_csv, parse_date,
                               parse_milli, parse_money, parse_stamp, parse_time, pct_text, stamp_local, to_csv,
                               week_start, weekday)


def test_div_round_halves_away_from_zero():
    assert div_round(5, 2) == 3
    assert div_round(-5, 2) == -3
    assert div_round(4, 3) == 1
    assert div_round(-4, 3) == -1
    assert mul_div(1500, 1999, 1000) == 2999      # 2998.5 rounds up
    assert mul_div(10 ** 9, 10 ** 9, 1000) == 10 ** 15
    with pytest.raises(ServiceError):
        div_round(1, 0)


def test_allocate_sums_and_ties():
    assert allocate(100, [1, 1, 1]) == [34, 33, 33]
    assert allocate(-100, [1, 1, 1]) == [-34, -33, -33]
    assert sum(allocate(997, [5, 7, 11, 13])) == 997
    assert allocate(0, [0, 0]) == [0, 0]
    with pytest.raises(ServiceError):
        allocate(5, [1, -1])


def test_dates_month_ends_and_leap_years():
    assert add_days("2024-02-28", 1) == "2024-02-29"
    assert add_days("2023-02-28", 1) == "2023-03-01"
    assert add_days("2100-02-28", 1) == "2100-03-01"     # 2100 is not a leap year
    assert add_days("2000-02-28", 1) == "2000-02-29"     # 2000 is
    assert add_months("2026-01-31", 1) == "2026-02-28"
    assert add_months("2028-01-31", 1) == "2028-02-29"
    assert add_months("2026-12-15", 1) == "2027-01-15"
    assert days_between("2026-12-31", "2027-01-01") == 1
    assert weekday("2026-10-22") == 4                    # a Thursday
    assert week_start("2026-11-01") == "2026-10-26"      # Sunday belongs to the week of Monday the 26th
    for bad in ("2026-02-29", "2026-13-01", "26-01-01", "2026-1-1", "", None, 20260101, "2201-01-01"):
        with pytest.raises(ServiceError):
            parse_date(bad)


def test_clock_times():
    assert parse_time("00:00") == 0
    assert parse_time("24:00") == 1440
    for bad in ("24:01", "7:00", "07:60", "07:00:00", "", "ab:cd"):
        with pytest.raises(ServiceError):
            parse_time(bad)


def test_stamps_and_daylight_saving():
    # US fall back 2026-11-01: 01:30 CDT (-05:00) then 01:15 CST (-06:00) is 45 minutes later.
    assert elapsed_minutes("2026-11-01T01:30:00-05:00", "2026-11-01T01:15:00-06:00") == 45
    # Spring forward 2027-03-14: 01:50 CST then 03:10 CDT is 20 minutes.
    assert elapsed_minutes("2027-03-14T01:50:00-06:00", "2027-03-14T03:10:00-05:00") == 20
    assert elapsed_minutes("2026-10-05T08:00:00Z", "2026-10-05T07:59:30Z") == 0      # rounds toward zero
    assert elapsed_minutes("2026-10-05T08:00:00Z", "2026-10-05T07:58:30Z") == -1
    assert parse_stamp("1970-01-01T00:00:00Z") == 0
    assert parse_stamp("1970-01-01T01:00:00+01:00") == 0
    assert stamp_local("2026-10-05T08:07:00-05:00") == ["2026-10-05", 487]
    assert elapsed_minutes("2026-10-05T23:30:00-05:00", "2026-10-06T00:15:00-05:00") == 45
    for bad in ("2026-10-05T08:00", "2026-10-05 08:00:00Z", "2026-10-05T25:00:00Z", "2026-10-05T08:00:00+15:00"):
        with pytest.raises(ServiceError):
            parse_stamp(bad)


def test_money_text_and_parsing():
    assert cents_text(-123456) == "-1234.56"
    assert money(123456789) == "$1,234,567.89"
    assert money(-5) == "-$0.05"
    assert milli_text(1500) == "1.5" and milli_text(2000) == "2" and milli_text(333) == "0.333"
    assert pct_text(1234) == "12.34%" and pct_text(-50) == "-0.50%"
    assert parse_money("$1,234.5") == 123450
    assert parse_money("-12") == -1200
    assert parse_money(".5") == 50
    assert parse_milli("1.25") == 1250 and parse_milli(".5") == 500
    for bad in ("1.234", "abc", "1e5", "", "--1"):
        with pytest.raises(ServiceError):
            parse_money(bad)
    with pytest.raises(ServiceError):
        parse_money("10000000.01")
    with pytest.raises(ServiceError):
        parse_milli("1.2345")


def test_clean_text():
    assert clean_text("  a\u0000b\tc  ", 10, "x") == "ab\tc"
    assert clean_text("a\r\nb", 10, "x", True) == "a\nb"
    assert clean_text("a\nb", 10, "x") == "a b"
    with pytest.raises(ServiceError):
        clean_text("x" * 11, 10, "x")
    with pytest.raises(ServiceError):
        clean_text(5, 10, "x")


def test_csv_formula_guard_and_round_trip():
    out = to_csv([["=SUM(A1)", "+1", "-x", "@cmd", "\tq", "plain", {"$": -1234}, 5, True, None, 'a,"b"']])
    assert out == "'=SUM(A1),'+1,'-x,'@cmd,'\tq,plain,-12.34,5,yes,,\"a,\"\"b\"\"\"\r\n"
    rows = parse_csv(out)["rows"]
    assert rows[0]["cells"][0] == "'=SUM(A1)" and rows[0]["cells"][-1] == 'a,"b"'
    # full-width forms and leading spaces are guarded too; text that only contains them is not
    out = to_csv([["\uff1d1", "\uff0b1", "\uff0d1", "\uff20x", "  =1", "\u3000\uff1d1", "a=b", " ok"]])
    assert out == "'\uff1d1,'\uff0b1,'\uff0d1,'\uff20x,'  =1,'\u3000\uff1d1,a=b, ok\r\n"


def test_parse_csv_hostile():
    assert parse_csv("a\tb\n1\t2\n\n")["delimiter"] == "\t"
    assert parse_csv('a,"multi\nline",c\n')["rows"][0]["cells"][1] == "multi\nline"
    with pytest.raises(ServiceError):
        parse_csv('a,"never closed\n')
    with pytest.raises(ServiceError):
        parse_csv("x" * (5 * 1024 * 1024 + 1))
    with pytest.raises(ServiceError):
        parse_csv("a\n" * 50_002)
    with pytest.raises(ServiceError):
        parse_csv("y" * 10_001)
    assert parse_csv("﻿name\nA\n")["rows"][0]["cells"] == ["name"]


def test_lone_surrogates_are_replaced():
    assert clean_text("a\ud800b", 10, "x") == "a�b"
    assert clean_text("\U0001F600", 1, "x") == "\U0001F600"
