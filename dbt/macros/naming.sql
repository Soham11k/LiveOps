{#
  Snowpitch runs one set of models against two warehouses, which name things
  differently:

    DuckDB     main.silver_players        (flat file, one schema)
    Snowflake  SNOWPITCH.SILVER.PLAYERS   (schema per medallion layer)

  Rather than fork the models, the layer is declared once per folder in
  dbt_project.yml (+schema: silver / gold) and these two hooks translate it
  into whatever the active target expects.
#}

{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if target.type == 'duckdb' -%}
        {#- DuckDB keeps everything in one schema; the layer moves into the alias. -#}
        {{ target.schema }}
    {%- elif custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim | upper }}
    {%- endif -%}
{%- endmacro %}


{% macro generate_alias_name(custom_alias_name=none, node=none) -%}
    {%- set base = custom_alias_name | trim if custom_alias_name is not none else node.name -%}
    {%- if target.type == 'duckdb'
           and node is not none
           and node.resource_type == 'model'
           and node.config.schema -%}
        {{ node.config.schema | trim | lower }}_{{ base | lower }}
    {%- else -%}
        {{ base }}
    {%- endif -%}
{%- endmacro %}
