using DesktopAiMascot.aiservice.chat;
using Xunit;

namespace DesktopAiMascotTest.aiservice.chat
{
    public class EmotionTagPromptHelperTests
    {
        [Fact]
        public void AppendEmotionTagInstruction_感情タグ指示が追記される()
        {
            var basePrompt = "テスト用のシステムプロンプト";

            var result = EmotionTagPromptHelper.AppendEmotionTagInstruction(basePrompt);

            Assert.Contains("【感情タグ】", result);
            Assert.Contains("[emotion: <id>]", result);
            Assert.Contains("admiration", result);
        }

        [Fact]
        public void AppendEmotionTagInstruction_既に感情タグ指示がある場合は追加しない()
        {
            var basePrompt = "【感情タグ】\n返答の先頭に感情タグを1つ付けてください。";

            var result = EmotionTagPromptHelper.AppendEmotionTagInstruction(basePrompt);

            Assert.Equal(basePrompt, result);
        }
    }
}
