/**
 * Document Editor Screen
 * Full PDF editor with real PDF rendering, annotations, and editing tools
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Dimensions,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Share,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../../src/contexts/ThemeContext';
import { Spacing, Typography, BorderRadius } from '../../src/constants/spacing';
import {
  storageService,
  formatFileSize,
  formatRelativeDate,
  StoredDocument,
} from '../../src/services/storageService';
import { pagesService } from '../../src/services/pages';
import { PDFViewer } from '../../src/components/pdf/PDFViewer';
import { AnnotationOverlay } from '../../src/components/pdf/AnnotationOverlay';
import { EditorToolbar } from '../../src/components/pdf/EditorToolbar';
import { useAnnotations } from '../../src/hooks/useAnnotations';
import { Point, TextAnnotation, Annotation } from '../../src/types/annotations';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const THUMBNAIL_WIDTH = 50;
const THUMBNAIL_HEIGHT = 70;

export default function DocumentEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();

  // Document state
  const [document, setDocument] = useState<StoredDocument | null>(null);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // PDF state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pdfDimensions, setPdfDimensions] = useState({ width: 595, height: 842 }); // A4 default
  const [scale, setScale] = useState(1.0);

  // Editor state
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Text input modal
  const [showTextModal, setShowTextModal] = useState(false);
  const [textInputValue, setTextInputValue] = useState('');
  const [textPosition, setTextPosition] = useState<Point | null>(null);

  // More options modal
  const [showMoreOptionsModal, setShowMoreOptionsModal] = useState(false);

  // Annotations hook
  const {
    annotations,
    activeTool,
    activeColor,
    strokeWidth,
    selectedAnnotationId,
    isModified,
    canUndo,
    canRedo,
    setActiveTool,
    setActiveColor,
    setStrokeWidth,
    setSelectedAnnotationId,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    undo,
    redo,
    exportAnnotations,
    resetModified,
  } = useAnnotations();

  // Refs
  const thumbnailScrollRef = useRef<ScrollView>(null);

  // ===========================================================================
  // Data Loading
  // ===========================================================================

  const loadDocument = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);
      console.log('[Editor] Loading document:', id);

      const doc = await storageService.getDocument(id);
      console.log('[Editor] Document loaded:', doc);
      setDocument(doc);
      setTotalPages(doc.page_count);

      // Acquire the PDF bytes to a local file (load → authenticated download).
      // There is no public stored-document download URL, so we cannot point the
      // viewer at a remote URL directly.
      const { localUri } = await storageService.downloadToFile(id);
      setPdfUri(localUri);
    } catch (err: any) {
      console.error('[Editor] Failed to load document:', err);
      setError(err.message || 'Impossible de charger le document');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  // ===========================================================================
  // PDF Callbacks
  // ===========================================================================

  const handlePdfLoadComplete = useCallback(
    (numberOfPages: number, width: number, height: number) => {
      console.log('[Editor] PDF loaded:', { numberOfPages, width, height });
      setTotalPages(numberOfPages);
      setPdfDimensions({ width, height });
    },
    []
  );

  const handlePdfError = useCallback((err: Error) => {
    console.error('[Editor] PDF error:', err);
    Alert.alert('Erreur', 'Impossible de charger le PDF');
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    // Scroll thumbnail into view
    thumbnailScrollRef.current?.scrollTo({
      x: (page - 1) * (THUMBNAIL_WIDTH + Spacing.sm),
      animated: true,
    });
  }, []);

  const handleScaleChanged = useCallback((newScale: number) => {
    setScale(newScale);
  }, []);

  const handlePageTap = useCallback(
    (page: number, x: number, y: number) => {
      if (activeTool === 'text') {
        setTextPosition({ x, y });
        setTextInputValue('');
        setShowTextModal(true);
      }
    },
    [activeTool]
  );

  // ===========================================================================
  // Page Navigation
  // ===========================================================================

  const goToPage = useCallback(
    (page: number) => {
      if (page >= 1 && page <= totalPages) {
        setCurrentPage(page);
        thumbnailScrollRef.current?.scrollTo({
          x: (page - 1) * (THUMBNAIL_WIDTH + Spacing.sm),
          animated: true,
        });
      }
    },
    [totalPages]
  );

  // ===========================================================================
  // Annotation Callbacks
  // ===========================================================================

  const handleAnnotationCreate = useCallback(
    (annotationData: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>) => {
      addAnnotation(annotationData);
    },
    [addAnnotation]
  );

  const handleAnnotationUpdate = useCallback(
    (annotId: string, updates: Partial<Annotation>) => {
      if ((updates as any).type === 'deleted') {
        deleteAnnotation(annotId);
      } else {
        updateAnnotation(annotId, updates);
      }
    },
    [updateAnnotation, deleteAnnotation]
  );

  const handleTextInput = useCallback((position: Point) => {
    setTextPosition(position);
    setTextInputValue('');
    setShowTextModal(true);
  }, []);

  const confirmTextAnnotation = useCallback(() => {
    if (!textInputValue.trim() || !textPosition) {
      setShowTextModal(false);
      return;
    }

    const textAnnotation: Omit<TextAnnotation, 'id' | 'createdAt' | 'updatedAt'> = {
      type: 'text',
      page: currentPage,
      position: textPosition,
      content: textInputValue.trim(),
      color: activeColor,
      opacity: 1,
      fontSize: 14,
      fontFamily: 'system',
      fontWeight: 'normal',
      fontStyle: 'normal',
    };

    addAnnotation(textAnnotation);
    setShowTextModal(false);
    setTextInputValue('');
    setTextPosition(null);
  }, [textInputValue, textPosition, currentPage, activeColor, addAnnotation]);

  // ===========================================================================
  // Save & Export
  // ===========================================================================

  const handleSave = useCallback(async () => {
    if (!id || !isModified) return;

    setIsSaving(true);
    try {
      // In a real app, we would save annotations to the backend
      // For now, we'll just show a success message
      const annotationsToSave = exportAnnotations();
      console.log('[Editor] Saving annotations:', annotationsToSave);

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));

      Alert.alert('Succes', 'Annotations sauvegardees');
      resetModified();
    } catch (err: any) {
      Alert.alert('Erreur', 'Impossible de sauvegarder');
    } finally {
      setIsSaving(false);
    }
  }, [id, isModified, exportAnnotations, resetModified]);

  const handleDownload = useCallback(async () => {
    if (!document) return;

    try {
      // The PDF is already downloaded locally on load; share that file.
      const fileUri = pdfUri ?? (await storageService.downloadToFile(id!)).localUri;

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Enregistrer le PDF',
        });
      }
    } catch (err: any) {
      Alert.alert('Erreur', 'Impossible de telecharger le document');
    }
  }, [id, document, pdfUri]);

  const handleShare = useCallback(async () => {
    if (!document) return;

    try {
      await Share.share({
        message: `Regardez ce document : ${document.name}`,
        title: document.name,
      });
    } catch (err: any) {
      console.error('Share error:', err);
    }
  }, [document]);

  const handleDelete = useCallback(() => {
    if (!id || !document) return;

    Alert.alert(
      'Supprimer le document',
      `Etes-vous sur de vouloir supprimer "${document.name}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await storageService.deleteDocuments([id]);
              router.back();
            } catch (err: any) {
              Alert.alert('Erreur', 'Impossible de supprimer le document');
            }
          },
        },
      ]
    );
  }, [id, document, router]);

  // ===========================================================================
  // Page Tools
  // ===========================================================================

  const handleRotatePage = useCallback(async () => {
    if (!id) return;

    Alert.alert('Pivoter la page', `Page ${currentPage}`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: '90° horaire',
        onPress: async () => {
          try {
            await pagesService.rotate(id, currentPage, { rotation: 90 });
            Alert.alert('Succes', 'Page pivotee');
            loadDocument();
          } catch (err: any) {
            Alert.alert('Erreur', 'Impossible de pivoter la page');
          }
        },
      },
      {
        text: '180°',
        onPress: async () => {
          try {
            await pagesService.rotate(id, currentPage, { rotation: 180 });
            Alert.alert('Succes', 'Page pivotee');
            loadDocument();
          } catch (err: any) {
            Alert.alert('Erreur', 'Impossible de pivoter la page');
          }
        },
      },
    ]);
  }, [id, currentPage, loadDocument]);

  const handleDeletePage = useCallback(async () => {
    if (!id || totalPages <= 1) {
      Alert.alert('Erreur', 'Impossible de supprimer la derniere page');
      return;
    }

    Alert.alert('Supprimer la page', `Supprimer la page ${currentPage} ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            await pagesService.delete(id, currentPage);
            Alert.alert('Succes', 'Page supprimee');
            if (currentPage > totalPages - 1) {
              setCurrentPage(totalPages - 1);
            }
            loadDocument();
          } catch (err: any) {
            Alert.alert('Erreur', 'Impossible de supprimer la page');
          }
        },
      },
    ]);
  }, [id, currentPage, totalPages, loadDocument]);

  // ===========================================================================
  // Render Functions
  // ===========================================================================

  const renderThumbnail = (pageNumber: number) => {
    const isActive = pageNumber === currentPage;

    return (
      <TouchableOpacity
        key={pageNumber}
        style={[
          styles.thumbnail,
          { borderColor: isActive ? colors.primary : colors.border },
          isActive && { borderWidth: 2 },
        ]}
        onPress={() => goToPage(pageNumber)}
      >
        <View style={[styles.thumbnailInner, { backgroundColor: colors.backgroundSecondary }]}>
          <Text style={[styles.thumbnailText, { color: colors.textSecondary }]}>
            {pageNumber}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  // Loading state
  if (loading) {
    return (
      <>
        <Stack.Screen
          options={{
            title: 'Chargement...',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
          }}
        />
        <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Chargement du document...
          </Text>
        </View>
      </>
    );
  }

  // Error state
  if (error) {
    return (
      <>
        <Stack.Screen
          options={{
            title: 'Erreur',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
          }}
        />
        <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>
            Impossible de charger le document
          </Text>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={loadDocument}
          >
            <Text style={[styles.retryButtonText, { color: colors.textInverse }]}>
              Reessayer
            </Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  if (!document || !id) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: document.name,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerRight: () => (
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.headerButton}
                onPress={() => setIsEditing(!isEditing)}
              >
                <Ionicons
                  name={isEditing ? 'eye-outline' : 'pencil'}
                  size={22}
                  color={isEditing ? colors.primary : colors.text}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerButton}
                onPress={() => setShowMoreOptionsModal(true)}
              >
                <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>
          ),
        }}
      />

      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Editor Toolbar (visible when editing) */}
        {isEditing && (
          <EditorToolbar
            activeTool={activeTool}
            activeColor={activeColor}
            strokeWidth={strokeWidth}
            onToolChange={setActiveTool}
            onColorChange={setActiveColor}
            onStrokeWidthChange={setStrokeWidth}
            onUndo={undo}
            onRedo={redo}
            onSave={handleSave}
            canUndo={canUndo}
            canRedo={canRedo}
            isModified={isModified}
            isSaving={isSaving}
          />
        )}

        {/* Document Info Bar */}
        <View style={[styles.infoBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            {document.page_count} pages • {formatFileSize(document.file_size_bytes)} •{' '}
            {formatRelativeDate(document.modified_at)}
          </Text>
        </View>

        {/* Page Thumbnails */}
        <View style={[styles.thumbnailsContainer, { backgroundColor: colors.surface }]}>
          <ScrollView
            ref={thumbnailScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbnailsScroll}
          >
            {Array.from({ length: totalPages }, (_, i) => renderThumbnail(i + 1))}
          </ScrollView>
        </View>

        {/* PDF Viewer with Annotation Overlay */}
        <View style={styles.pdfContainer}>
          {pdfUri ? (
            <PDFViewer
              sourceUri={pdfUri}
              currentPage={currentPage}
              scale={scale}
              onPageChange={handlePageChange}
              onLoadComplete={handlePdfLoadComplete}
              onError={handlePdfError}
              onPageSingleTap={handlePageTap}
              onScaleChanged={handleScaleChanged}
            >
              {isEditing && (
                <AnnotationOverlay
                  annotations={annotations}
                  currentPage={currentPage}
                  activeTool={activeTool}
                  activeColor={activeColor}
                  strokeWidth={strokeWidth}
                  opacity={1}
                  selectedAnnotationId={selectedAnnotationId}
                  onAnnotationCreate={handleAnnotationCreate}
                  onAnnotationSelect={setSelectedAnnotationId}
                  onAnnotationUpdate={handleAnnotationUpdate}
                  onTextInput={handleTextInput}
                  scale={scale}
                  pageWidth={pdfDimensions.width}
                  pageHeight={pdfDimensions.height}
                />
              )}
            </PDFViewer>
          ) : null}
        </View>

        {/* Page Navigation */}
        <View style={[styles.pageNavigation, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.navButton, currentPage <= 1 && styles.navButtonDisabled]}
            onPress={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            <Ionicons
              name="chevron-back"
              size={24}
              color={currentPage <= 1 ? colors.textTertiary : colors.text}
            />
          </TouchableOpacity>

          <Text style={[styles.pageIndicator, { color: colors.text }]}>
            Page {currentPage} / {totalPages}
          </Text>

          <TouchableOpacity
            style={[styles.navButton, currentPage >= totalPages && styles.navButtonDisabled]}
            onPress={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            <Ionicons
              name="chevron-forward"
              size={24}
              color={currentPage >= totalPages ? colors.textTertiary : colors.text}
            />
          </TouchableOpacity>
        </View>

        {/* Quick Tools Bar (when not editing) */}
        {!isEditing && (
          <View style={[styles.quickToolsBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity style={styles.quickTool} onPress={handleRotatePage}>
              <Ionicons name="sync-outline" size={22} color={colors.text} />
              <Text style={[styles.quickToolLabel, { color: colors.textSecondary }]}>
                Pivoter
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickTool} onPress={handleDeletePage}>
              <Ionicons name="trash-outline" size={22} color={colors.error} />
              <Text style={[styles.quickToolLabel, { color: colors.error }]}>
                Supprimer
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickTool} onPress={handleDownload}>
              <Ionicons name="download-outline" size={22} color={colors.text} />
              <Text style={[styles.quickToolLabel, { color: colors.textSecondary }]}>
                Telecharger
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickTool} onPress={handleShare}>
              <Ionicons name="share-outline" size={22} color={colors.text} />
              <Text style={[styles.quickToolLabel, { color: colors.textSecondary }]}>
                Partager
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.editButton, { backgroundColor: colors.primary }]}
              onPress={() => setIsEditing(true)}
            >
              <Ionicons name="pencil" size={20} color="#fff" />
              <Text style={styles.editButtonText}>Editer</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Text Input Modal */}
      <Modal
        visible={showTextModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTextModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setShowTextModal(false)}>
            <View style={[styles.textInputModal, { backgroundColor: colors.surface }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Ajouter du texte
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
                ]}
                placeholder="Entrez votre texte..."
                placeholderTextColor={colors.textTertiary}
                value={textInputValue}
                onChangeText={setTextInputValue}
                multiline
                autoFocus
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, { borderColor: colors.border }]}
                  onPress={() => setShowTextModal(false)}
                >
                  <Text style={[styles.modalButtonText, { color: colors.textSecondary }]}>
                    Annuler
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: colors.primary }]}
                  onPress={confirmTextAnnotation}
                >
                  <Text style={[styles.modalButtonText, { color: '#fff' }]}>Ajouter</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* More Options Modal */}
      <Modal
        visible={showMoreOptionsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMoreOptionsModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowMoreOptionsModal(false)}
        >
          <View style={[styles.optionsModal, { backgroundColor: colors.surface }]}>
            <TouchableOpacity
              style={styles.optionItem}
              onPress={() => {
                setShowMoreOptionsModal(false);
                handleDownload();
              }}
            >
              <Ionicons name="download-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>Telecharger</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionItem}
              onPress={() => {
                setShowMoreOptionsModal(false);
                handleShare();
              }}
            >
              <Ionicons name="share-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>Partager</Text>
            </TouchableOpacity>

            <View style={[styles.optionDivider, { backgroundColor: colors.border }]} />

            <TouchableOpacity
              style={styles.optionItem}
              onPress={() => {
                setShowMoreOptionsModal(false);
                handleDelete();
              }}
            >
              <Ionicons name="trash-outline" size={24} color={colors.error} />
              <Text style={[styles.optionText, { color: colors.error }]}>Supprimer</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: Typography.md,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  errorTitle: {
    fontSize: Typography.lg,
    fontWeight: '600',
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  errorText: {
    fontSize: Typography.md,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
  },
  retryButtonText: {
    fontSize: Typography.md,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  headerButton: {
    padding: Spacing.sm,
  },
  infoBar: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
  },
  infoText: {
    fontSize: Typography.xs,
    textAlign: 'center',
  },
  thumbnailsContainer: {
    paddingVertical: Spacing.sm,
  },
  thumbnailsScroll: {
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  thumbnail: {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    overflow: 'hidden',
    marginRight: Spacing.sm,
  },
  thumbnailInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailText: {
    fontSize: Typography.sm,
    fontWeight: '600',
  },
  pdfContainer: {
    flex: 1,
  },
  pageNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderTopWidth: 1,
  },
  navButton: {
    padding: Spacing.sm,
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  pageIndicator: {
    fontSize: Typography.md,
    fontWeight: '500',
  },
  quickToolsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderTopWidth: 1,
    gap: Spacing.md,
  },
  quickTool: {
    alignItems: 'center',
    flex: 1,
  },
  quickToolLabel: {
    fontSize: Typography.xs,
    marginTop: 4,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  editButtonText: {
    color: '#fff',
    fontSize: Typography.sm,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textInputModal: {
    width: '85%',
    maxWidth: 360,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  modalTitle: {
    fontSize: Typography.lg,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    fontSize: Typography.md,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  modalButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modalButtonText: {
    fontSize: Typography.md,
    fontWeight: '500',
  },
  optionsModal: {
    position: 'absolute',
    bottom: Spacing.xl,
    left: Spacing.lg,
    right: Spacing.lg,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.sm,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  optionText: {
    fontSize: Typography.md,
    fontWeight: '500',
  },
  optionDivider: {
    height: 1,
    marginVertical: Spacing.sm,
  },
});
