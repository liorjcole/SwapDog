import React, { useState } from 'react';
import { View, FlatList, Image, Dimensions, StyleSheet, Text } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

const { width } = Dimensions.get('window');

interface Props {
  photos: string[];
  height?: number;
}

const PhotoCarousel: React.FC<Props> = ({ photos, height = 240 }) => {
  const { colors } = useTheme();
  const [index, setIndex] = useState(0);

  if (photos.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={styles.placeholderText} accessibilityLabel="No photos available">🐶</Text>
      </View>
    );
  }

  return (
    <View>
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onMomentumScrollEnd={(e) => {
          setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
        }}
        renderItem={({ item, index: i }) => (
          <Image
            source={{ uri: item }}
            style={{ width, height }}
            accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
          />
        )}
      />
      {photos.length > 1 && (
        <View style={styles.dots} accessibilityElementsHidden>
          {photos.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === index && { backgroundColor: colors.primary },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  placeholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f0f0' },
  placeholderText: { fontSize: 50 },
  dots: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ccc', marginHorizontal: 3 },
});

export default PhotoCarousel;
