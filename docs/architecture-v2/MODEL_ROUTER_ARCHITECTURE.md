# Model Router Architecture

**Status:** Review required

## Purpose

The Model Router selects and invokes the best permitted AI model for a bounded assignment. It keeps The Dost Matrix independent from any single provider.

## Separation of responsibility

The Director specifies required capabilities and constraints. The Model Router selects the actual provider and model.

## Provider abstraction

Every provider adapter supports a common contract:

- declare capabilities;
- estimate cost and context capacity;
- invoke and stream;
- cancel;
- return normalized usage;
- normalize errors;
- expose health;
- declare privacy characteristics.

Provider-specific payloads remain inside adapters.

## Model profile

```text
provider
model_id
capabilities
context_window
output_limit
modalities
tool_support
structured_output_support
latency_class
cost_profile
privacy_profile
region
reliability_score
quality_scores
availability
version
```

## Routing request

```text
assignment_id
required_capabilities
preferred_capabilities
input_modalities
output_format
context_size
privacy_level
maximum_cost
maximum_latency
quality_priority
allowlists
denylists
fallback_policy
owner_preference
```

## Routing process

```text
1. Remove forbidden candidates
2. Remove incapable candidates
3. Remove candidates that exceed limits
4. Score remaining candidates
5. Select primary model
6. Build a permitted fallback chain
7. Execute
8. Record actual performance
```

## Scoring dimensions

Capability fit, quality, context fit, privacy, cost, latency, reliability, tool compatibility, structured-output reliability, provider health, owner preference and historical role performance.

## Strategies

- Best quality
- Lowest cost
- Fastest
- Privacy first
- Balanced
- Fixed by owner
- Council
- Escalation after low confidence or failure

## Fallbacks

Fallbacks may handle timeouts, rate limits, malformed output, unavailable models and context overflow. They may never silently violate privacy, budget or provider restrictions.

## Performance learning

The router records task type, model, cost, latency, usage, errors, schema success, QA result, Director evaluation and owner feedback.

## Local models

Local models are first-class providers for sensitive context, offline work, repetitive tasks, embeddings and resilience.

## Model Council

Council execution defines independent members, diversity requirements, budget, judge method, disagreement handling and evidence. The final decision remains with the Director.
