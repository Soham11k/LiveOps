{#
  Portability shims.

  The raw telemetry lands as JSON in both warehouses, but they read it very
  differently: DuckDB uses json_extract() path syntax against a VARCHAR, while
  Snowflake uses the colon operator against a native VARIANT. These macros keep
  that difference in one file instead of smeared across every staging model.
#}

{% macro json_str(column, key) -%}
    {%- if target.type == 'duckdb' -%}
        json_extract_string({{ column }}, '$.{{ key }}')
    {%- else -%}
        {{ column }}:{{ key }}::string
    {%- endif -%}
{%- endmacro %}


{% macro json_int(column, key) -%}
    {%- if target.type == 'duckdb' -%}
        cast(json_extract({{ column }}, '$.{{ key }}') as integer)
    {%- else -%}
        {{ column }}:{{ key }}::number
    {%- endif -%}
{%- endmacro %}


{% macro json_float(column, key) -%}
    {%- if target.type == 'duckdb' -%}
        cast(json_extract({{ column }}, '$.{{ key }}') as double)
    {%- else -%}
        {{ column }}:{{ key }}::float
    {%- endif -%}
{%- endmacro %}


{% macro json_bool(column, key) -%}
    {%- if target.type == 'duckdb' -%}
        cast(json_extract({{ column }}, '$.{{ key }}') as boolean)
    {%- else -%}
        {{ column }}:{{ key }}::boolean
    {%- endif -%}
{%- endmacro %}


{#
  Conditional aggregates. Snowflake has COUNT_IF, DuckDB has the SQL-standard
  FILTER clause, and neither accepts the other. CASE works on both.
#}

{% macro count_if(condition) -%}
    sum(case when {{ condition }} then 1 else 0 end)
{%- endmacro %}


{% macro count_distinct_if(condition, column) -%}
    count(distinct case when {{ condition }} then {{ column }} end)
{%- endmacro %}


{% macro share_if(condition) -%}
    sum(case when {{ condition }} then 1 else 0 end) * 1.0 / nullif(count(*), 0)
{%- endmacro %}


{#
  The wash-trading signature, defined once. The alert mart and the data test
  both call this, so a tuned threshold can never leave them disagreeing.
#}

{% macro is_wash_trade() -%}
    price > median_ref * {{ var('wash_price_multiple') }}
    and seconds_listed < {{ var('wash_max_seconds_listed') }}
{%- endmacro %}
