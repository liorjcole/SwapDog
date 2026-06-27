import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { DiscoverStackParamList } from '../../navigation/types';
import { useTheme } from '../../contexts/ThemeContext';
import { useDogs } from '../../hooks/useDogs';
import { Dog } from '../../models/types';
import { spacing, borderRadius, typography } from '../../config/theme';
import PhotoCarousel from '../../components/common/PhotoCarousel';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import Chip from '../../components/common/Chip';
import { formatDogAge } from '../../utils/formatDogAge';

type Props = {
  route: RouteProp<DiscoverStackParamList, 'DogDetail'>;
};

const DogDetailScreen: React.FC<Props> = ({ route }) => {
  const { colors } = useTheme();
  const { dogId } = route.params ?? {};
  const { getDog } = useDogs();
  const [dog, setDog] = useState<Dog | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDog(dogId).then((d) => { setDog(d); setLoading(false); });
  }, [dogId]);

  if (loading) return <LoadingSpinner />;
  if (!dog) return null;

  const traits: string[] = [];
  if (dog.isGoodWithDogs) traits.push('Good with dogs');
  if (dog.isGoodWithKids) traits.push('Good with kids');
  if (dog.isSpayedNeutered) traits.push('Spayed/Neutered');
  if (dog.vaccinated) traits.push('Vaccinated');

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <PhotoCarousel photos={dog.photoURLs} height={280} />
      <View style={styles.content}>
        <Text style={[styles.name, { color: colors.text }]} accessibilityRole="header">{dog.name}</Text>
        <Text style={[styles.breed, { color: colors.textSecondary }]}>{dog.breed}</Text>
        <View style={styles.row}>
          <Chip label={formatDogAge(dog.ageYears, dog.ageMonths)} />
          {dog.weightLbs > 0 && <Chip label={`${dog.weightLbs} lbs`} />}
          <Chip label={dog.sex} />
          <Chip label={`${dog.energyLevel.replace('_', ' ')} energy`} />
        </View>
        {dog.bio && <Text style={[styles.bio, { color: colors.text }]}>{dog.bio}</Text>}
        {traits.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>About</Text>
            <View style={styles.row}>
              {traits.map((t) => <Chip key={t} label={t} selected />)}
            </View>
          </>
        )}
        {dog.temperament && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Temperament</Text>
            <Text style={[styles.bio, { color: colors.text }]}>{dog.temperament}</Text>
          </>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg },
  name: { ...typography.h2, marginBottom: spacing.xs },
  breed: { fontSize: 18, marginBottom: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  bio: { ...typography.body, marginBottom: spacing.lg, lineHeight: 22 },
  sectionTitle: { ...typography.h3, marginBottom: spacing.sm },
});

export default DogDetailScreen;
