/**
 * Language detection + lookup tests. The detector is a char-script heuristic
 * over the user's own turns — no model call.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  detectLanguage,
  languagePromptName,
  languageLabel,
  isLanguageCode,
} from '../src/lib/language';

describe('detectLanguage', () => {
  it('defaults to English for Latin / empty / sparse input', () => {
    assert.equal(detectLanguage([]), 'en');
    assert.equal(detectLanguage(['fix the auth bug', 'add a test for the parser']), 'en');
    // a single Chinese word amid English must NOT flip the default
    assert.equal(detectLanguage(['ok 继续', 'looks good, ship it']), 'en');
  });

  it('detects Chinese (Han, no kana)', () => {
    assert.equal(
      detectLanguage(['你帮我确认一下这个插件能不能采集数据', '算了，先别加校验，先做环境变量覆盖']),
      'zh',
    );
  });

  it('detects Japanese when kana is present (even with Kanji)', () => {
    assert.equal(
      detectLanguage(['この機能を追加してください', 'テストも書いてほしいです']),
      'ja',
    );
  });

  it('detects Korean (Hangul)', () => {
    assert.equal(detectLanguage(['이 기능을 추가해 주세요', '테스트도 작성해 주세요 그리고 확인']), 'ko');
  });

  it('detects Russian (Cyrillic)', () => {
    assert.equal(detectLanguage(['добавь пожалуйста авторизацию и тесты сюда']), 'ru');
  });

  it('does not flip on a mostly-English mix with a little CJK', () => {
    assert.equal(detectLanguage(['please refactor the config loader, 谢谢']), 'en');
  });
});

describe('language lookup', () => {
  it('promptName falls back to English for unknown codes', () => {
    assert.equal(languagePromptName('en'), 'English');
    assert.equal(languagePromptName('zh').startsWith('Chinese'), true);
    assert.equal(languagePromptName('xx'), 'English');
  });
  it('isLanguageCode validates against the supported set', () => {
    assert.equal(isLanguageCode('zh'), true);
    assert.equal(isLanguageCode('ja'), true);
    assert.equal(isLanguageCode('auto'), false);
    assert.equal(isLanguageCode('xx'), false);
    assert.equal(isLanguageCode(42), false);
  });
  it('label returns a human string', () => {
    assert.equal(languageLabel('ko').includes('Korean'), true);
  });
});
