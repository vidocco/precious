import type { Visibility } from '@precious/shared';

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: 'Only you',
  household: 'Shared with household',
  public: 'Anyone with the link',
};
