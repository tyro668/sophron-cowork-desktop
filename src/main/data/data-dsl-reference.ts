import {
  getPrepDslQuickReference,
  getPrepDslReference,
  type PrepDslReferenceTopic,
} from '../../shared/prep-dsl';

export type DataDslReferenceTopic = PrepDslReferenceTopic;

export function getWorkflowDslReference(topic: DataDslReferenceTopic = 'all'): string {
  return getPrepDslReference(topic);
}

export function getWorkflowDslQuickReference(): string {
  return getPrepDslQuickReference();
}
