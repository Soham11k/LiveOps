{#
  A custom generic test. Rates, shares and counts make up most of this
  warehouse and every one of them has a legal range; a win rate of 1.4 or a
  negative trade count means the transform broke, not that the game got weird.
  Declaring the range in YAML keeps that check next to the column it guards.
#}

{% test accepted_range(model, column_name, min_value=none, max_value=none) %}

select
    {{ column_name }} as offending_value,
    count(*) as rows_affected
from {{ model }}
where {{ column_name }} is not null
  and (
        {%- if min_value is not none %}
        {{ column_name }} < {{ min_value }}
        {%- endif %}
        {%- if min_value is not none and max_value is not none %} or {% endif %}
        {%- if max_value is not none %}
        {{ column_name }} > {{ max_value }}
        {%- endif %}
  )
group by 1

{% endtest %}
