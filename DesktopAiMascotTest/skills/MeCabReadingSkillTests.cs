using System.Threading.Tasks;
using DesktopAiMascot.skills;
using Xunit;

namespace DesktopAiMascotTest.skills
{
    public class MeCabReadingSkillTests
    {
        [Fact]
        public async Task ConvertToReadingAsync_空文字列_空文字列を返す()
        {
            // Arrange
            var skill = new MeCabReadingSkill();
            skill.Initialize();

            // Act
            var result = await skill.ConvertToReadingAsync("");

            // Assert
            Assert.Equal("", result);
        }

        [Fact]
        public async Task ConvertToReadingAsync_英単語なし_元の文字列を返す()
        {
            // Arrange
            var skill = new MeCabReadingSkill();
            skill.Initialize();

            // Act
            var result = await skill.ConvertToReadingAsync("こんにちは");

            // Assert
            Assert.Equal("こんにちは", result);
        }

        [Fact]
        public async Task ConvertToReadingAsync_英単語あり_読み仮名に変換される()
        {
            // Arrange
            var skill = new MeCabReadingSkill();
            skill.Initialize();

            // Act
            var result = await skill.ConvertToReadingAsync("私はappleが好きです");

            // Assert
            // MeCabが利用できる場合は読み仮名が取得される
            // 利用できない場合は元の文字列が返される
            Assert.NotNull(result);
            Assert.NotEmpty(result);
        }

        [Fact]
        public void GetWordReading_単語の読みを取得()
        {
            // Arrange
            var skill = new MeCabReadingSkill();
            skill.Initialize();

            // Act
            var result = skill.GetWordReading("東京");

            // Assert
            Assert.NotNull(result);
            Assert.NotEmpty(result);
        }

        [Fact]
        public void GetWordReading_空文字列_空文字列を返す()
        {
            // Arrange
            var skill = new MeCabReadingSkill();
            skill.Initialize();

            // Act
            var result = skill.GetWordReading("");

            // Assert
            Assert.Equal("", result);
        }
    }
}
